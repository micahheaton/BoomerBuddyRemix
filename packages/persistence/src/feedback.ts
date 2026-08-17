import {
  DomainError,
  assertFeedbackSourceCompatible,
  canonicalFeedbackNetworkAddress,
  feedbackContentReadableStatuses,
  feedbackSourceSurfaces,
  feedbackTypes,
  initialFeedbackQueue,
  isFeedbackContentReadableStatus,
  type FeedbackChannelClass,
  type FeedbackClassification,
  type FeedbackCloseLoopState,
  type FeedbackEvidenceTier,
  type FeedbackIdentityMode,
  type FeedbackLinkedObjectType,
  type FeedbackQueue,
  type FeedbackRoutingState,
  type FeedbackSeverity,
  type FeedbackSourceSurface,
  type FeedbackStatus,
  type FeedbackType,
} from '@boomerbuddy/domain';
import {
  decryptField,
  encryptField,
  fingerprintMinimized,
  parseEncryptedField,
  redactSensitiveInput,
  restrictedInputPlaceholders,
  serializeEncryptedField,
  type MinimizedInput,
  type SafeRedaction,
} from '@boomerbuddy/security';
import type { Database, SqlExecutor } from './database';
import { enqueueDurableJobWithExecutor } from './jobs';
import { asDate, jsonParameter, randomIdFactory, type IdFactory } from './values';

const feedbackOperationKeyPattern =
  /^feedback:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const correlationPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,199}$/u;
const localOperationalRetentionMs = 60 * 60_000;
const localResearchRetentionCeilingMs = 24 * 60 * 60_000;
const anonymousLeaseMs = 30_000;
const anonymousGlobalPerHour = 60;
const anonymousNetworkPerHour = 5;
const anonymousGlobalConcurrency = 10;
const anonymousNetworkConcurrency = 1;
const explicitCredentialPlaceholder = restrictedInputPlaceholders.authorization_credential;
const reservedFeedbackPlaceholders = [
  {
    placeholder: restrictedInputPlaceholders.payment_card,
    className: 'payment_card',
  },
  {
    placeholder: restrictedInputPlaceholders.authorization_credential,
    className: 'authorization_credential',
  },
  {
    placeholder: restrictedInputPlaceholders.one_time_code,
    className: 'one_time_code',
  },
] as const;

export type FeedbackAuthorityClock = (transaction: SqlExecutor, observedAt: Date) => Promise<Date>;

const databaseFeedbackAuthorityClock: FeedbackAuthorityClock = async (transaction) => {
  const result = await transaction.query<{ authority_now: unknown } & Record<string, unknown>>(
    'SELECT clock_timestamp() AS authority_now',
  );
  return asDate(result.rows[0]?.authority_now, 'feedback database authority time');
};

export interface FeedbackProtection {
  readonly encryptionKey: Uint8Array;
  readonly encryptionKeyVersion: number;
  readonly fingerprintKey: Uint8Array;
  readonly fingerprintKeyVersion: number;
}

interface AnonymousFeedbackLease {
  readonly id: string;
  readonly networkHmac: string;
}

export interface FeedbackSourceInput {
  readonly surface: FeedbackSourceSurface;
  readonly appVersion?: string | undefined;
  readonly buildVersion?: string | undefined;
  readonly locale?: string | undefined;
  readonly deviceClass: 'desktop' | 'tablet' | 'phone' | 'unknown';
}

export type FeedbackFollowUpInput =
  | { readonly granted: false }
  | {
      readonly granted: true;
      readonly purpose: 'feedback_follow_up';
      readonly consentVersion: 'feedback-follow-up-v1';
      readonly channelClass: FeedbackChannelClass;
    };

export type FeedbackResearchRetentionInput =
  | { readonly granted: false }
  | {
      readonly granted: true;
      readonly purpose: 'product_feedback_research';
      readonly consentVersion: 'feedback-research-v1';
      readonly retainUntil: string;
    };

export type FeedbackLinkInput =
  | { readonly permitted: false }
  | {
      readonly permitted: true;
      readonly consentVersion: 'feedback-linkage-v1';
      readonly objectType: FeedbackLinkedObjectType;
      readonly objectId: string;
    };

export interface FeedbackIntakeRequest {
  readonly operationKey: string;
  readonly text: string;
  readonly feedbackType: FeedbackType;
  readonly source: FeedbackSourceInput;
  readonly link: FeedbackLinkInput;
  readonly followUp: FeedbackFollowUpInput;
  readonly researchRetention: FeedbackResearchRetentionInput;
}

export interface SupportFeedbackConversionInput {
  readonly operationKey: string;
  readonly text: string;
  readonly feedbackType: FeedbackType;
  readonly source: FeedbackSourceInput & { readonly surface: 'support_conversion' };
}

export interface FeedbackIntakeResult {
  readonly id: string;
  readonly status: 'queued_unassigned' | 'assigned' | 'unsafe_unprocessable';
  readonly redactionStatus: 'minimized_clean' | 'minimized_redacted' | 'quarantined_discarded';
  readonly queue: FeedbackQueue;
  readonly evidenceTier: 'local_simulation';
  readonly retainedUntil?: Date;
  readonly reused: boolean;
  readonly mediaAccepted: false;
  readonly providerProcessed: false;
  readonly externalActionExecuted: false;
}

export interface HqFeedbackQueueItem {
  readonly id: string;
  readonly identityMode: FeedbackIdentityMode;
  readonly householdId?: string;
  readonly sourceSurface: FeedbackSourceSurface;
  readonly feedbackType: FeedbackType;
  readonly status: FeedbackStatus;
  readonly severity: FeedbackSeverity;
  readonly classification: FeedbackClassification;
  readonly queue: FeedbackQueue;
  readonly routingState: FeedbackRoutingState;
  readonly redactionStatus: FeedbackIntakeResult['redactionStatus'];
  readonly duplicateOfFeedbackId?: string;
  readonly clusterId?: string;
  readonly resultingActionType?: 'issue' | 'experiment' | 'content' | 'support_action';
  readonly resultingActionId?: string;
  readonly closeLoopState: FeedbackCloseLoopState;
  readonly followUpConsented: boolean;
  readonly researchRetentionConsented: boolean;
  readonly evidenceTier: FeedbackEvidenceTier;
  readonly version: number;
  readonly createdAt: Date;
  readonly routedAt: Date;
  readonly assignedAt?: Date;
  readonly contentReadAuthorized: boolean;
  readonly selfClaimAvailable: boolean;
}

export interface FeedbackReviewClaimResult {
  readonly feedbackId: string;
  readonly queue: FeedbackQueue;
  readonly assignmentVersion: number;
  readonly humanReviewRequired: boolean;
  readonly reused: boolean;
  readonly evidenceTier: 'local_simulation';
  readonly externalActionExecuted: false;
}

export interface AssignedFeedbackContent {
  readonly feedbackId: string;
  readonly minimizedText: string;
  readonly redactionStatus: 'minimized_clean' | 'minimized_redacted';
  readonly evidenceTier: 'local_simulation';
  readonly contentBoundary: 'assigned_minimized_text';
  readonly externalActionExecuted: false;
}

interface IntakeOperationRow extends Record<string, unknown> {
  readonly request_digest: string;
  readonly feedback_id: string | null;
  readonly response_status: 'queued_unassigned' | 'assigned' | 'unsafe_unprocessable' | null;
  readonly response_redaction_status: FeedbackIntakeResult['redactionStatus'] | null;
  readonly response_queue: FeedbackQueue | null;
  readonly response_retained_until: unknown | null;
}

interface HqFeedbackRow extends Record<string, unknown> {
  readonly id: string;
  readonly identity_mode: FeedbackIdentityMode;
  readonly household_id: string | null;
  readonly source_surface: FeedbackSourceSurface;
  readonly feedback_type: FeedbackType;
  readonly to_status: FeedbackStatus;
  readonly severity: FeedbackSeverity;
  readonly classification: FeedbackClassification;
  readonly queue: FeedbackQueue;
  readonly routing_state: FeedbackRoutingState;
  readonly redaction_status: FeedbackIntakeResult['redactionStatus'];
  readonly duplicate_of_feedback_id: string | null;
  readonly cluster_id: string | null;
  readonly resulting_action_type: 'issue' | 'experiment' | 'content' | 'support_action' | null;
  readonly resulting_action_id: string | null;
  readonly close_loop_state: FeedbackCloseLoopState;
  readonly follow_up_consented: boolean;
  readonly research_retention_consented: boolean;
  readonly evidence_tier: FeedbackEvidenceTier;
  readonly version: number;
  readonly created_at: unknown;
  readonly routed_at: unknown;
  readonly assigned_at: unknown | null;
  readonly content_read_authorized: boolean;
  readonly self_claim_available: boolean;
}

interface InternalAssignmentRow extends Record<string, unknown> {
  readonly id: string;
  readonly role: 'hq_owner' | 'hq_reviewer' | 'hq_support';
}

function assertProtection(protection: FeedbackProtection): void {
  if (protection.encryptionKey.byteLength !== 32 || protection.fingerprintKey.byteLength < 32) {
    throw new TypeError('Feedback encryption and fingerprint keys are invalid');
  }
  if (
    !Number.isSafeInteger(protection.encryptionKeyVersion) ||
    protection.encryptionKeyVersion < 1 ||
    !Number.isSafeInteger(protection.fingerprintKeyVersion) ||
    protection.fingerprintKeyVersion < 1
  ) {
    throw new TypeError('Feedback key versions must be valid');
  }
}

function assertCommonInput(input: {
  readonly operationKey: string;
  readonly text: string;
  readonly feedbackType: FeedbackType;
  readonly source: FeedbackSourceInput;
  readonly correlationId: string;
  readonly now: Date;
}): void {
  if (
    !feedbackOperationKeyPattern.test(input.operationKey) ||
    typeof input.text !== 'string' ||
    input.text.trim().length < 4 ||
    Buffer.byteLength(input.text.trim(), 'utf8') > 8_192 ||
    !feedbackTypes.includes(input.feedbackType) ||
    !feedbackSourceSurfaces.includes(input.source.surface) ||
    !correlationPattern.test(input.correlationId) ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new DomainError('invalid_input', 'Feedback intake metadata is invalid');
  }
}

function researchDeadline(input: FeedbackResearchRetentionInput, now: Date): Date {
  if (!input.granted) return new Date(now.getTime() + localOperationalRetentionMs);
  const requested = new Date(input.retainUntil);
  if (
    !Number.isFinite(requested.getTime()) ||
    requested.getTime() <= now.getTime() ||
    requested.getTime() > now.getTime() + localResearchRetentionCeilingMs
  ) {
    throw new DomainError(
      'invalid_input',
      'Local feedback research retention must be future-dated within 24 hours',
    );
  }
  return requested;
}

function hourBucket(now: Date): string {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
}

type ExplicitCredentialMinimization =
  | { readonly status: 'accepted'; readonly minimized: string; readonly count: number }
  | { readonly status: 'rejected' };

function redactExplicitCredentialLabels(input: string): ExplicitCredentialMinimization {
  const spans: Array<{ readonly start: number; readonly end: number }> = [];
  const labelPattern =
    /(?:^|[^\p{L}\p{N}_])(?:(authorization|auth|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?token|id[_ -]?token|private[_ -]?token|client[_ -]?secret|credential|secret|token|pwd|pass(?:word|code))\s*(?::|=|\bis\b)\s*|(bearer|basic)\s+)/gimu;
  for (const match of input.matchAll(labelPattern)) {
    const matchIndex = match.index;
    const label = (match[1] ?? match[2])?.toLowerCase();
    if (matchIndex === undefined || label === undefined) return { status: 'rejected' };
    let valueStart = matchIndex + match[0].length;
    if (label === 'authorization') {
      const scheme = /^(?:bearer|basic)\s+/iu.exec(input.slice(valueStart));
      if (scheme !== null) valueStart += scheme[0].length;
    }
    if (input.startsWith(explicitCredentialPlaceholder, valueStart)) continue;
    const openingQuote = input[valueStart];
    if (openingQuote === '"' || openingQuote === "'") {
      const lineEndCandidate = input.indexOf('\n', valueStart + 1);
      const lineEnd = lineEndCandidate < 0 ? input.length : lineEndCandidate;
      const closingQuote = input.indexOf(openingQuote, valueStart + 1);
      if (closingQuote < 0 || closingQuote >= lineEnd || closingQuote === valueStart + 1) {
        return { status: 'rejected' };
      }
      const next = input[closingQuote + 1];
      if (next !== undefined && !/[\s;,.)!?]/u.test(next)) return { status: 'rejected' };
      spans.push({ start: valueStart, end: closingQuote + 1 });
      continue;
    }
    const unquoted = /^\S+/u.exec(input.slice(valueStart));
    if (unquoted === null || unquoted[0].length === 0) return { status: 'rejected' };
    const valueEnd = valueStart + unquoted[0].length;
    const lineEndCandidate = input.indexOf('\n', valueEnd);
    const lineEnd = lineEndCandidate < 0 ? input.length : lineEndCandidate;
    const remainder = input.slice(valueEnd, lineEnd).trim();
    if (remainder !== '' && !/[;,.)!?]$/u.test(unquoted[0])) return { status: 'rejected' };
    spans.push({ start: valueStart, end: valueEnd });
  }
  if (spans.length === 0) return { status: 'accepted', minimized: input, count: 0 };
  const ordered = spans.sort((left, right) => left.start - right.start || left.end - right.end);
  if (
    ordered.some((span, index) => {
      const next = ordered[index + 1];
      return next !== undefined && next.start < span.end;
    })
  ) {
    return { status: 'rejected' };
  }
  let minimized = '';
  let cursor = 0;
  for (const span of ordered) {
    minimized += `${input.slice(cursor, span.start)}${explicitCredentialPlaceholder}`;
    cursor = span.end;
  }
  return {
    status: 'accepted',
    minimized: `${minimized}${input.slice(cursor)}`,
    count: ordered.length,
  };
}

function canonicalRequest(input: {
  readonly identityMode: FeedbackIdentityMode;
  readonly householdId?: string;
  readonly actorPersonId?: string;
  readonly supportCaseId?: string;
  readonly request: FeedbackIntakeRequest | SupportFeedbackConversionInput;
}): string {
  return JSON.stringify({
    identityMode: input.identityMode,
    householdId: input.householdId ?? null,
    actorPersonId: input.actorPersonId ?? null,
    supportCaseId: input.supportCaseId ?? null,
    operationKey: input.request.operationKey,
    text: input.request.text.normalize('NFKC').replace(/\r\n?/gu, '\n').trim(),
    feedbackType: input.request.feedbackType,
    source: input.request.source,
    ...('link' in input.request
      ? {
          link: input.request.link,
          followUp: input.request.followUp,
          researchRetention: input.request.researchRetention,
        }
      : {}),
  });
}

function initialActor(input: {
  readonly identityMode: FeedbackIdentityMode;
  readonly actorPersonId?: string;
}): {
  readonly kind: 'participant' | 'anonymous_participant' | 'hq';
  readonly personId?: string;
} {
  if (input.identityMode === 'anonymous') return { kind: 'anonymous_participant' };
  if (input.actorPersonId === undefined) throw new TypeError('Feedback actor is unavailable');
  return {
    kind: input.identityMode === 'support_conversion' ? 'hq' : 'participant',
    personId: input.actorPersonId,
  };
}

function minimizeFeedbackText(input: string, allowReservedPlaceholders: boolean): MinimizedInput {
  try {
    const normalized = input.normalize('NFKC').replace(/\r\n?/gu, '\n').trim();
    if (!allowReservedPlaceholders) {
      const submittedPlaceholderClasses = reservedFeedbackPlaceholders
        .filter(({ placeholder }) => normalized.includes(placeholder))
        .map(({ className }) => className);
      if (submittedPlaceholderClasses.length > 0) {
        const detected = redactSensitiveInput(normalized, 8_192).detected;
        return {
          status: 'rejected',
          detected: [...new Set([...detected, ...submittedPlaceholderClasses])],
          reason: 'restricted_input',
        };
      }
    }
    const explicit = redactExplicitCredentialLabels(normalized);
    if (explicit.status === 'rejected') {
      const detected = redactSensitiveInput(normalized, 8_192).detected;
      return {
        status: 'rejected',
        detected: [...new Set([...detected, 'authorization_credential' as const])],
        reason: 'ambiguous_credential',
      };
    }
    const minimized = redactSensitiveInput(explicit.minimized, 8_192);
    if (minimized.status === 'rejected' || explicit.count === 0) return minimized;
    const priorAuthorization = minimized.redactions.find(
      (redaction) => redaction.class === 'authorization_credential',
    );
    const redactions: SafeRedaction[] = minimized.redactions.filter(
      (redaction) => redaction.class !== 'authorization_credential',
    );
    redactions.push({
      class: 'authorization_credential',
      placeholder: explicitCredentialPlaceholder,
      count: explicit.count + (priorAuthorization?.count ?? 0),
    });
    return {
      status: 'accepted',
      minimized: minimized.minimized,
      detected: [...new Set([...minimized.detected, 'authorization_credential' as const])],
      redactions,
      safetyFlags: [
        ...new Set([...minimized.safetyFlags, 'contained_authorization_credential' as const]),
      ],
    };
  } catch {
    throw new DomainError('invalid_input', 'Feedback text is outside the bounded intake envelope');
  }
}

function minimizeSubmittedFeedbackText(input: string): MinimizedInput {
  return minimizeFeedbackText(input, false);
}

function verifyRetainedMinimizedFeedbackText(input: string): MinimizedInput {
  return minimizeFeedbackText(input, true);
}

function redactionCountMetadata(redactions: readonly SafeRedaction[]): Record<string, number> {
  return Object.fromEntries(redactions.map((redaction) => [redaction.class, redaction.count]));
}

export class FeedbackRepository {
  constructor(
    private readonly database: Database,
    private readonly protection: FeedbackProtection,
    private readonly ids: IdFactory = randomIdFactory,
    private readonly authorityClock: FeedbackAuthorityClock = databaseFeedbackAuthorityClock,
  ) {
    assertProtection(protection);
  }

  private async authorityNow(executor: SqlExecutor, observedAt: Date): Promise<Date> {
    const authorityNow = await this.authorityClock(executor, observedAt);
    if (!(authorityNow instanceof Date) || !Number.isFinite(authorityNow.getTime())) {
      throw new DomainError('conflict', 'Feedback database authority time is unavailable');
    }
    return new Date(authorityNow);
  }

  private digestRequest(input: Parameters<typeof canonicalRequest>[0]): string {
    return fingerprintMinimized(canonicalRequest(input), this.protection.fingerprintKey, {
      tenantId: input.householdId ?? 'anonymous_feedback',
      purpose: 'feedback-idempotency-v1',
      keyVersion: this.protection.fingerprintKeyVersion,
    }).value;
  }

  private async lockInternalAssignments(
    executor: SqlExecutor,
    actorPersonId: string,
  ): Promise<readonly InternalAssignmentRow[]> {
    const assignments = await executor.query<InternalAssignmentRow>(
      `SELECT employee.id, employee.role
       FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.status = 'active'
         AND organization.kind = 'internal'
         AND employee.role IN ('hq_owner', 'hq_reviewer', 'hq_support')
       ORDER BY employee.id
       FOR UPDATE OF employee, organization`,
      [actorPersonId],
    );
    if (assignments.rowCount === 0) {
      throw new DomainError('not_authorized', 'Feedback review requires a current internal role');
    }
    return assignments.rows;
  }

  private async currentInternalAssignments(
    executor: SqlExecutor,
    actorPersonId: string,
  ): Promise<readonly InternalAssignmentRow[]> {
    const assignments = await executor.query<InternalAssignmentRow>(
      `SELECT employee.id, employee.role
       FROM employee_assignments employee
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.status = 'active'
         AND organization.kind = 'internal'
         AND employee.role IN ('hq_owner', 'hq_reviewer', 'hq_support')
       ORDER BY employee.id`,
      [actorPersonId],
    );
    if (assignments.rowCount === 0) {
      throw new DomainError('not_authorized', 'Feedback review requires a current internal role');
    }
    return assignments.rows;
  }

  private async lockFeedbackReviewMutex(executor: SqlExecutor): Promise<void> {
    const mutex = await executor.query(
      `SELECT singleton FROM feedback_review_concurrency_mutex
       WHERE singleton = true FOR UPDATE`,
    );
    if (mutex.rowCount !== 1) {
      throw new DomainError('conflict', 'Feedback review concurrency control is unavailable');
    }
  }

  private async lockCurrentSupportVisibility(
    executor: SqlExecutor,
    actorPersonId: string,
  ): Promise<void> {
    await executor.query(
      `SELECT support_case.id
       FROM support_cases support_case
       JOIN support_case_assignments support_assignment
         ON support_assignment.household_id = support_case.household_id
        AND support_assignment.case_id = support_case.id
       JOIN employee_assignments employee
         ON employee.id = support_assignment.employee_assignment_id
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE employee.person_id = $1 AND employee.status = 'active'
         AND employee.role = 'hq_support' AND organization.kind = 'internal'
         AND support_case.status = 'open' AND support_assignment.status = 'active'
       ORDER BY support_case.household_id, support_case.id, support_assignment.employee_assignment_id
       FOR UPDATE OF support_case, support_assignment, employee, organization`,
      [actorPersonId],
    );
  }

  private async exactSupportAssignment(
    executor: SqlExecutor,
    input: {
      readonly householdId: string;
      readonly supportCaseId: string;
      readonly actorPersonId: string;
    },
  ): Promise<string> {
    const result = await executor.query<{ readonly id: string } & Record<string, unknown>>(
      `SELECT employee.id
       FROM support_cases support_case
       JOIN support_case_assignments assignment
         ON assignment.household_id = support_case.household_id
        AND assignment.case_id = support_case.id
       JOIN employee_assignments employee ON employee.id = assignment.employee_assignment_id
       JOIN organizations organization ON organization.id = employee.organization_id
       WHERE support_case.household_id = $1 AND support_case.id = $2
         AND support_case.status = 'open' AND assignment.status = 'active'
         AND employee.person_id = $3 AND employee.role = 'hq_support'
         AND employee.status = 'active' AND organization.kind = 'internal'
       ORDER BY employee.id LIMIT 1 FOR UPDATE OF support_case, assignment, employee, organization`,
      [input.householdId, input.supportCaseId, input.actorPersonId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainError(
        'not_authorized',
        'Support conversion requires the current exact internal support-case assignment',
      );
    }
    return row.id;
  }

  private async assertAuthenticatedScope(
    executor: SqlExecutor,
    input: {
      readonly householdId: string;
      readonly actorPersonId: string;
      readonly link: FeedbackLinkInput;
      readonly observedAt: Date;
    },
  ): Promise<void> {
    const membership = await executor.query<Record<string, unknown>>(
      `SELECT 1 FROM household_memberships
       WHERE household_id = $1 AND person_id = $2 AND status = 'active' FOR UPDATE`,
      [input.householdId, input.actorPersonId],
    );
    if (membership.rowCount !== 1) {
      throw new DomainError('not_authorized', 'Feedback requires current household membership');
    }
    if (!input.link.permitted) return;
    let linked: { readonly rowCount: number; readonly rows: readonly Record<string, unknown>[] };
    if (input.link.objectType === 'check') {
      linked = await executor.query<Record<string, unknown>>(
        `SELECT artifact.delete_after FROM analyses analysis
         JOIN artifacts artifact
           ON artifact.household_id = analysis.household_id AND artifact.id = analysis.artifact_id
         WHERE analysis.household_id = $1 AND analysis.id = $2
           AND analysis.requested_by = $3 AND analysis.state = 'completed'
           AND artifact.state = 'active'
         FOR UPDATE OF analysis, artifact`,
        [input.householdId, input.link.objectId, input.actorPersonId],
      );
    } else if (input.link.objectType === 'orientation') {
      linked = await executor.query(
        `SELECT 1 FROM orientation_states
         WHERE household_id = $1 AND person_id = $2 AND person_id = $3 FOR UPDATE`,
        [input.householdId, input.actorPersonId, input.link.objectId],
      );
    } else {
      linked = await executor.query(
        `SELECT 1 FROM commerce_subscriptions
         WHERE household_id = $1 AND id = $2 AND payer_person_id = $3 FOR UPDATE`,
        [input.householdId, input.link.objectId, input.actorPersonId],
      );
    }
    if (linked.rowCount !== 1) {
      throw new DomainError(
        'not_authorized',
        'Feedback linked-object authority is unavailable for this exact participant',
      );
    }
    if (input.link.objectType === 'check') {
      const authorityNow = await this.authorityNow(executor, input.observedAt);
      const deleteAfter = asDate(
        linked.rows[0]?.delete_after,
        'feedback linked Check artifact expiry',
      );
      if (deleteAfter <= authorityNow) {
        throw new DomainError(
          'not_authorized',
          'Feedback linked-object authority is unavailable for this exact participant',
        );
      }
    }
  }

  private operationResult(row: IntakeOperationRow, reused: boolean): FeedbackIntakeResult {
    if (
      row.feedback_id === null ||
      row.response_status === null ||
      row.response_redaction_status === null ||
      row.response_queue === null
    ) {
      throw new DomainError('conflict', 'Feedback intake operation is incomplete');
    }
    return {
      id: row.feedback_id,
      status: row.response_status,
      redactionStatus: row.response_redaction_status,
      queue: row.response_queue,
      evidenceTier: 'local_simulation',
      ...(row.response_retained_until === null
        ? {}
        : { retainedUntil: asDate(row.response_retained_until, 'feedback retained until') }),
      reused,
      mediaAccepted: false,
      providerProcessed: false,
      externalActionExecuted: false,
    };
  }

  private async insertConsent(
    executor: SqlExecutor,
    input: {
      readonly feedbackId: string;
      readonly purpose: 'follow_up' | 'research_retention' | 'object_linkage';
      readonly state: 'granted' | 'declined';
      readonly purposeCode?:
        'feedback_follow_up' | 'product_feedback_research' | 'feedback_object_linkage';
      readonly consentVersion?:
        'feedback-follow-up-v1' | 'feedback-research-v1' | 'feedback-linkage-v1';
      readonly channelClass?: FeedbackChannelClass;
      readonly retainUntil?: Date;
      readonly actor: ReturnType<typeof initialActor> | { readonly kind: 'system' };
      readonly reasonCode: string;
      readonly now: Date;
    },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO feedback_consent_events(
         id, feedback_id, purpose, sequence, state, purpose_code, consent_version,
         channel_class, retain_until, actor_kind, actor_person_id, reason_code, occurred_at
       ) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        this.ids.next('feedback-consent'),
        input.feedbackId,
        input.purpose,
        input.state,
        input.purposeCode ?? null,
        input.consentVersion ?? null,
        input.channelClass ?? null,
        input.retainUntil?.toISOString() ?? null,
        input.actor.kind,
        'personId' in input.actor ? (input.actor.personId ?? null) : null,
        input.reasonCode,
        input.now.toISOString(),
      ],
    );
  }

  private async insertState(
    executor: SqlExecutor,
    input: {
      readonly feedbackId: string;
      readonly version: number;
      readonly fromStatus?: FeedbackStatus;
      readonly toStatus: FeedbackStatus;
      readonly actor:
        ReturnType<typeof initialActor> | { readonly kind: 'system'; readonly serviceKey: string };
      readonly reasonCode: string;
      readonly severity?: FeedbackSeverity;
      readonly classification?: FeedbackClassification;
      readonly duplicateOfFeedbackId?: string;
      readonly clusterId?: string;
      readonly customerImpactCode?: string;
      readonly resultingActionType?: 'issue' | 'experiment' | 'content' | 'support_action';
      readonly resultingActionId?: string;
      readonly closeLoopState?: FeedbackCloseLoopState;
      readonly now: Date;
    },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO feedback_state_events(
         id, feedback_id, version, from_status, to_status, severity, classification,
         duplicate_of_feedback_id, cluster_id, customer_impact_code, resulting_action_type,
         resulting_action_id, close_loop_state, reason_code, actor_kind, actor_person_id,
         service_key, evidence_tier, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         'local_simulation',$18)`,
      [
        this.ids.next('feedback-state'),
        input.feedbackId,
        input.version,
        input.fromStatus ?? null,
        input.toStatus,
        input.severity ?? 'unassessed',
        input.classification ?? 'unclassified',
        input.duplicateOfFeedbackId ?? null,
        input.clusterId ?? null,
        input.customerImpactCode ?? null,
        input.resultingActionType ?? null,
        input.resultingActionId ?? null,
        input.closeLoopState ?? 'not_requested',
        input.reasonCode,
        input.actor.kind,
        'personId' in input.actor ? (input.actor.personId ?? null) : null,
        'serviceKey' in input.actor ? input.actor.serviceKey : null,
        input.now.toISOString(),
      ],
    );
  }

  private async enqueueProcessing(
    executor: SqlExecutor,
    input: {
      readonly feedbackId: string;
      readonly householdId?: string;
      readonly feedbackVersion: number;
      readonly unsafe: boolean;
      readonly correlationId: string;
      readonly now: Date;
    },
  ): Promise<void> {
    const definitions = [
      {
        step: 'redaction_verification' as const,
        type: 'feedback.redaction.verify',
        priority: input.unsafe ? 100 : 70,
      },
      ...(input.unsafe
        ? []
        : [
            { step: 'classification' as const, type: 'feedback.classify.local', priority: 60 },
            { step: 'deduplication' as const, type: 'feedback.deduplicate.local', priority: 50 },
            { step: 'internal_draft' as const, type: 'feedback.draft.local', priority: 20 },
          ]),
    ];
    for (const definition of definitions) {
      const queued = await enqueueDurableJobWithExecutor(executor, this.ids, {
        type: definition.type,
        version: 1,
        ...(input.householdId === undefined ? {} : { householdId: input.householdId }),
        classification: 'confidential',
        payload: {
          feedbackId: input.feedbackId,
          expectedVersion: input.feedbackVersion,
          processingStep: definition.step,
          localOnly: true,
        },
        idempotencyKey: `feedback:${input.feedbackId}:${definition.step}:v${input.feedbackVersion}`,
        deduplicationKey: `feedback:${input.feedbackId}:${definition.step}`,
        priority: definition.priority,
        scheduledAt: input.now,
        maxAttempts: 3,
        correlationId: input.correlationId,
      });
      await executor.query(
        `INSERT INTO feedback_processing_jobs(
           id, feedback_id, processing_step, durable_job_id, expected_feedback_version,
           receipt_state, result_code, evidence_tier, provider_processed,
           external_action_executed, created_at
         ) VALUES ($1,$2,$3,$4,$5,'queued','local_processing_not_run','local_simulation',
           false,false,$6)`,
        [
          this.ids.next('feedback-processing'),
          input.feedbackId,
          definition.step,
          queued.job.id,
          input.feedbackVersion,
          input.now.toISOString(),
        ],
      );
    }
  }

  private async createInsideTransaction(
    executor: SqlExecutor,
    input: {
      readonly identityMode: FeedbackIdentityMode;
      readonly householdId?: string;
      readonly actorPersonId?: string;
      readonly supportCaseId?: string;
      readonly request: FeedbackIntakeRequest | SupportFeedbackConversionInput;
      readonly routing:
        | { readonly state: 'unassigned' }
        | {
            readonly state: 'assigned';
            readonly assignmentId: string;
            readonly assignmentActorPersonId: string;
          };
      readonly requestDigest: string;
      readonly correlationId: string;
      readonly now: Date;
    },
  ): Promise<FeedbackIntakeResult> {
    const intakeStartedAt = await this.authorityNow(executor, input.now);
    const inserted = await executor.query(
      `INSERT INTO feedback_intake_operations(operation_key, request_digest, created_at)
       VALUES ($1,$2,$3) ON CONFLICT (operation_key) DO NOTHING`,
      [input.request.operationKey, input.requestDigest, intakeStartedAt.toISOString()],
    );
    const existing = await executor.query<IntakeOperationRow>(
      `SELECT request_digest, feedback_id, response_status, response_redaction_status,
              response_queue, response_retained_until
       FROM feedback_intake_operations WHERE operation_key = $1 FOR UPDATE`,
      [input.request.operationKey],
    );
    const operation = existing.rows[0];
    if (operation === undefined) throw new Error('Feedback intake operation did not persist');
    if (operation.request_digest !== input.requestDigest) {
      throw new DomainError('conflict', 'Feedback idempotency key has conflicting evidence');
    }
    if (inserted.rowCount === 0) return this.operationResult(operation, true);
    const authorityNow = await this.authorityNow(executor, input.now);

    const minimized = minimizeSubmittedFeedbackText(input.request.text);
    const unsafe = minimized.status === 'rejected';
    const feedbackId = this.ids.next('feedback');
    const actor = initialActor(input);
    const link = 'link' in input.request ? input.request.link : undefined;
    const research =
      'researchRetention' in input.request
        ? input.request.researchRetention
        : ({ granted: false } as const);
    const retainedUntil = unsafe ? undefined : researchDeadline(research, authorityNow);
    const redactionStatus: FeedbackIntakeResult['redactionStatus'] = unsafe
      ? 'quarantined_discarded'
      : minimized.redactions.length === 0
        ? 'minimized_clean'
        : 'minimized_redacted';
    const queue = initialFeedbackQueue({ feedbackType: input.request.feedbackType, unsafe });
    const linkedObjectType =
      input.identityMode === 'support_conversion'
        ? 'support_case'
        : link?.permitted
          ? link.objectType
          : undefined;
    const linkedObjectId =
      input.identityMode === 'support_conversion'
        ? input.supportCaseId
        : link?.permitted
          ? link.objectId
          : undefined;

    await executor.query(
      `INSERT INTO feedback_records(
         id, schema_version, identity_mode, household_id, actor_person_id, source_surface,
         app_version, build_version, locale, device_class, feedback_type, linked_object_type,
         linked_object_id, linkage_consent_version, origin_interaction_id, correlation_id,
         evidence_tier, created_at
       ) VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,$14,
         'local_simulation',$15)`,
      [
        feedbackId,
        input.identityMode,
        input.householdId ?? null,
        input.actorPersonId ?? null,
        input.request.source.surface,
        input.request.source.appVersion ?? null,
        input.request.source.buildVersion ?? null,
        input.request.source.locale ?? null,
        input.request.source.deviceClass,
        input.request.feedbackType,
        linkedObjectType ?? null,
        linkedObjectId ?? null,
        link?.permitted ? link.consentVersion : null,
        input.correlationId,
        authorityNow.toISOString(),
      ],
    );

    if (unsafe) {
      await executor.query(
        `INSERT INTO feedback_payloads(
           feedback_id, payload_state, encrypted_text, encryption_key_version,
           redaction_status, detected_classes, redaction_counts, retention_deadline,
           created_at, erased_at
         ) VALUES ($1,'discarded_unsafe',NULL,NULL,'quarantined_discarded',$2::jsonb,
           '{}'::jsonb,NULL,$3,NULL)`,
        [feedbackId, jsonParameter(minimized.detected), authorityNow.toISOString()],
      );
    } else {
      const tenantId = input.householdId ?? 'anonymous_feedback';
      const encrypted = encryptField(minimized.minimized, this.protection.encryptionKey, {
        tenantId,
        resourceId: feedbackId,
        field: 'minimized_text',
        schemaVersion: 1,
        keyVersion: this.protection.encryptionKeyVersion,
      });
      await executor.query(
        `INSERT INTO feedback_payloads(
           feedback_id, payload_state, encrypted_text, encryption_key_version,
           redaction_status, detected_classes, redaction_counts, retention_deadline,
           created_at, erased_at
         ) VALUES ($1,'encrypted_minimized',$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,NULL)`,
        [
          feedbackId,
          serializeEncryptedField(encrypted),
          this.protection.encryptionKeyVersion,
          redactionStatus,
          jsonParameter(minimized.detected),
          jsonParameter(redactionCountMetadata(minimized.redactions)),
          retainedUntil?.toISOString(),
          authorityNow.toISOString(),
        ],
      );
    }

    await this.insertState(executor, {
      feedbackId,
      version: 1,
      toStatus: 'received',
      actor,
      reasonCode: 'bounded_text_received',
      now: authorityNow,
    });
    await this.insertState(executor, {
      feedbackId,
      version: 2,
      fromStatus: 'received',
      toStatus: unsafe ? 'unsafe_unprocessable' : 'minimized',
      actor: { kind: 'system', serviceKey: 'feedback.local_minimizer' },
      reasonCode: unsafe ? 'unsafe_text_discarded' : 'local_minimization_completed',
      ...(unsafe ? { classification: 'out_of_scope_or_unsafe' as const } : {}),
      now: authorityNow,
    });

    if ('followUp' in input.request) {
      await this.insertConsent(executor, {
        feedbackId,
        purpose: 'follow_up',
        state: input.request.followUp.granted ? 'granted' : 'declined',
        ...(input.request.followUp.granted
          ? {
              purposeCode: input.request.followUp.purpose,
              consentVersion: input.request.followUp.consentVersion,
              channelClass: input.request.followUp.channelClass,
            }
          : {}),
        actor,
        reasonCode: input.request.followUp.granted ? 'participant_granted' : 'participant_declined',
        now: authorityNow,
      });
      await this.insertConsent(executor, {
        feedbackId,
        purpose: 'research_retention',
        state: input.request.researchRetention.granted ? 'granted' : 'declined',
        ...(input.request.researchRetention.granted
          ? {
              purposeCode: input.request.researchRetention.purpose,
              consentVersion: input.request.researchRetention.consentVersion,
              retainUntil: new Date(input.request.researchRetention.retainUntil),
            }
          : {}),
        actor,
        reasonCode: input.request.researchRetention.granted
          ? 'participant_granted'
          : 'participant_declined',
        now: authorityNow,
      });
      if (unsafe && input.request.researchRetention.granted) {
        await executor.query(
          `INSERT INTO feedback_consent_events(
             id, feedback_id, purpose, sequence, state, purpose_code, consent_version,
             channel_class, retain_until, actor_kind, actor_person_id, reason_code, occurred_at
           ) VALUES ($1,$2,'research_retention',2,'restricted',NULL,NULL,NULL,NULL,
             'system',NULL,'unsafe_payload_discarded',$3)`,
          [this.ids.next('feedback-consent'), feedbackId, authorityNow.toISOString()],
        );
      }
      if (input.request.link.permitted) {
        await this.insertConsent(executor, {
          feedbackId,
          purpose: 'object_linkage',
          state: 'granted',
          purposeCode: 'feedback_object_linkage',
          consentVersion: input.request.link.consentVersion,
          actor,
          reasonCode: 'participant_granted',
          now: authorityNow,
        });
      }
    } else {
      for (const purpose of ['follow_up', 'research_retention'] as const) {
        await this.insertConsent(executor, {
          feedbackId,
          purpose,
          state: 'declined',
          actor: { kind: 'system' },
          reasonCode: 'support_cannot_grant_participant_consent',
          now: authorityNow,
        });
      }
    }

    if (input.routing.state === 'assigned') {
      await executor.query(
        `INSERT INTO feedback_assignment_events(
           id, feedback_id, version, routing_state, queue, employee_assignment_id,
           assigned_by_person_id, service_key, reason_code, occurred_at
         ) VALUES ($1,$2,1,'assigned',$3,$4,$5,NULL,'bounded_initial_routing',$6)`,
        [
          this.ids.next('feedback-assignment'),
          feedbackId,
          queue,
          input.routing.assignmentId,
          input.routing.assignmentActorPersonId,
          authorityNow.toISOString(),
        ],
      );
    } else {
      await executor.query(
        `INSERT INTO feedback_assignment_events(
           id, feedback_id, version, routing_state, queue, employee_assignment_id,
           assigned_by_person_id, service_key, reason_code, occurred_at
         ) VALUES ($1,$2,1,'unassigned',$3,NULL,NULL,'feedback.local_router',
           'bounded_initial_routing',$4)`,
        [this.ids.next('feedback-assignment'), feedbackId, queue, authorityNow.toISOString()],
      );
    }
    let feedbackVersion = 2;
    let responseStatus: FeedbackIntakeResult['status'] = 'unsafe_unprocessable';
    if (!unsafe && input.routing.state === 'assigned') {
      feedbackVersion = 3;
      responseStatus = 'assigned';
      await this.insertState(executor, {
        feedbackId,
        version: feedbackVersion,
        fromStatus: 'minimized',
        toStatus: 'assigned',
        actor: { kind: 'system', serviceKey: 'feedback.local_router' },
        reasonCode: 'bounded_initial_routing',
        closeLoopState: 'human_review_required',
        now: authorityNow,
      });
    } else if (!unsafe) {
      responseStatus = 'queued_unassigned';
    }
    await this.enqueueProcessing(executor, {
      feedbackId,
      ...(input.householdId === undefined ? {} : { householdId: input.householdId }),
      feedbackVersion,
      unsafe,
      correlationId: input.correlationId,
      now: authorityNow,
    });
    await executor.query(
      `UPDATE feedback_intake_operations
       SET feedback_id = $2, response_status = $3, response_redaction_status = $4,
           response_queue = $5, response_retained_until = $6, completed_at = $7
       WHERE operation_key = $1`,
      [
        input.request.operationKey,
        feedbackId,
        responseStatus,
        redactionStatus,
        queue,
        retainedUntil?.toISOString() ?? null,
        authorityNow.toISOString(),
      ],
    );
    return {
      id: feedbackId,
      status: responseStatus,
      redactionStatus,
      queue,
      evidenceTier: 'local_simulation',
      ...(retainedUntil === undefined ? {} : { retainedUntil }),
      reused: false,
      mediaAccepted: false,
      providerProcessed: false,
      externalActionExecuted: false,
    };
  }

  async createAuthenticated(input: {
    readonly householdId: string;
    readonly actorPersonId: string;
    readonly request: FeedbackIntakeRequest;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<FeedbackIntakeResult> {
    assertCommonInput({ ...input.request, correlationId: input.correlationId, now: input.now });
    if (!stableIdPattern.test(input.householdId) || !stableIdPattern.test(input.actorPersonId)) {
      throw new DomainError('invalid_input', 'Feedback participant scope is invalid');
    }
    assertFeedbackSourceCompatible({
      identityMode: 'authenticated',
      sourceSurface: input.request.source.surface,
      ...(input.request.link.permitted ? { linkedObjectType: input.request.link.objectType } : {}),
    });
    const requestDigest = this.digestRequest({
      identityMode: 'authenticated',
      householdId: input.householdId,
      actorPersonId: input.actorPersonId,
      request: input.request,
    });
    return this.database.transaction(async (transaction) => {
      await this.assertAuthenticatedScope(transaction, {
        householdId: input.householdId,
        actorPersonId: input.actorPersonId,
        link: input.request.link,
        observedAt: input.now,
      });
      return this.createInsideTransaction(transaction, {
        identityMode: 'authenticated',
        householdId: input.householdId,
        actorPersonId: input.actorPersonId,
        request: input.request,
        routing: { state: 'unassigned' },
        requestDigest,
        correlationId: input.correlationId,
        now: input.now,
      });
    });
  }

  private async acquireAnonymousLease(
    networkAddress: string,
    now: Date,
  ): Promise<AnonymousFeedbackLease> {
    let canonicalNetworkAddress: string;
    try {
      canonicalNetworkAddress = canonicalFeedbackNetworkAddress(networkAddress);
    } catch {
      throw new DomainError('invalid_input', 'Anonymous feedback network scope is invalid');
    }
    const networkHmac = fingerprintMinimized(
      canonicalNetworkAddress,
      this.protection.fingerprintKey,
      {
        tenantId: 'anonymous_feedback',
        purpose: 'network-quota-v1',
        keyVersion: this.protection.fingerprintKeyVersion,
      },
    ).value;
    const leaseId = this.ids.next('feedback-lease');
    await this.database.transaction(async (transaction) => {
      const mutex = await transaction.query(
        `SELECT singleton FROM feedback_anonymous_concurrency_mutex
         WHERE singleton = true FOR UPDATE`,
      );
      if (mutex.rowCount !== 1) {
        throw new DomainError('conflict', 'Anonymous feedback concurrency control is unavailable');
      }
      const authorityNow = await this.authorityNow(transaction, now);
      await transaction.query(
        `DELETE FROM feedback_anonymous_processing_leases WHERE expires_at <= $1`,
        [authorityNow.toISOString()],
      );
      for (const quota of [
        { scope: 'global', key: 'global', maximum: anonymousGlobalPerHour },
        { scope: 'network', key: networkHmac, maximum: anonymousNetworkPerHour },
      ] as const) {
        const consumed = await transaction.query(
          `INSERT INTO feedback_anonymous_quota_buckets(scope, bucket_start, scope_key, used_count)
           VALUES ($1,$2,$3,1)
           ON CONFLICT (scope, bucket_start, scope_key) DO UPDATE
           SET used_count = feedback_anonymous_quota_buckets.used_count + 1
           WHERE feedback_anonymous_quota_buckets.used_count < $4
           RETURNING used_count`,
          [quota.scope, hourBucket(authorityNow), quota.key, quota.maximum],
        );
        if (consumed.rowCount !== 1) {
          throw new DomainError('conflict', 'Anonymous feedback capacity is temporarily exhausted');
        }
      }
      const concurrency = await transaction.query<
        { readonly global_count: number; readonly network_count: number } & Record<string, unknown>
      >(
        `SELECT count(*)::int AS global_count,
                count(*) FILTER (WHERE client_key_hmac = $1)::int AS network_count
         FROM feedback_anonymous_processing_leases WHERE expires_at > $2`,
        [networkHmac, authorityNow.toISOString()],
      );
      const counts = concurrency.rows[0];
      if (
        counts === undefined ||
        counts.global_count >= anonymousGlobalConcurrency ||
        counts.network_count >= anonymousNetworkConcurrency
      ) {
        throw new DomainError('conflict', 'Anonymous feedback processing capacity is exhausted');
      }
      await transaction.query(
        `INSERT INTO feedback_anonymous_processing_leases(id, client_key_hmac, created_at, expires_at)
         VALUES ($1,$2,$3,$4)`,
        [
          leaseId,
          networkHmac,
          authorityNow.toISOString(),
          new Date(authorityNow.getTime() + anonymousLeaseMs).toISOString(),
        ],
      );
    });
    return { id: leaseId, networkHmac };
  }

  private async beginAnonymousLeaseOwnership(
    transaction: SqlExecutor,
    lease: AnonymousFeedbackLease,
    observedAt: Date,
  ): Promise<void> {
    const locked = await transaction.query<
      { readonly expires_at: unknown } & Record<string, unknown>
    >(
      `SELECT expires_at FROM feedback_anonymous_processing_leases
       WHERE id = $1 AND client_key_hmac = $2 FOR UPDATE`,
      [lease.id, lease.networkHmac],
    );
    const row = locked.rows[0];
    const authorityNow = await this.authorityNow(transaction, observedAt);
    if (
      row === undefined ||
      asDate(row.expires_at, 'anonymous feedback lease expiration') <= authorityNow
    ) {
      throw new DomainError('conflict', 'Anonymous feedback lease ownership is unavailable');
    }
    const renewed = await transaction.query(
      `UPDATE feedback_anonymous_processing_leases
       SET expires_at = $3
       WHERE id = $1 AND client_key_hmac = $2
       RETURNING id`,
      [
        lease.id,
        lease.networkHmac,
        new Date(authorityNow.getTime() + anonymousLeaseMs).toISOString(),
      ],
    );
    if (renewed.rowCount !== 1) {
      throw new DomainError('conflict', 'Anonymous feedback lease ownership is unavailable');
    }
  }

  private async renewAnonymousLeaseOwnership(
    transaction: SqlExecutor,
    lease: AnonymousFeedbackLease,
    observedAt: Date,
  ): Promise<void> {
    const authorityNow = await this.authorityNow(transaction, observedAt);
    const renewed = await transaction.query(
      `UPDATE feedback_anonymous_processing_leases
       SET expires_at = $3
       WHERE id = $1 AND client_key_hmac = $2
       RETURNING id`,
      [
        lease.id,
        lease.networkHmac,
        new Date(authorityNow.getTime() + anonymousLeaseMs).toISOString(),
      ],
    );
    if (renewed.rowCount !== 1) {
      throw new DomainError('conflict', 'Anonymous feedback lease renewal failed');
    }
  }

  async createAnonymous(input: {
    readonly networkAddress: string;
    readonly request: FeedbackIntakeRequest;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<FeedbackIntakeResult> {
    assertCommonInput({ ...input.request, correlationId: input.correlationId, now: input.now });
    if (input.request.link.permitted || input.request.followUp.granted) {
      throw new DomainError(
        'invalid_input',
        'Anonymous feedback cannot include account linkage or follow-up authority',
      );
    }
    assertFeedbackSourceCompatible({
      identityMode: 'anonymous',
      sourceSurface: input.request.source.surface,
    });
    const lease = await this.acquireAnonymousLease(input.networkAddress, input.now);
    try {
      const requestDigest = this.digestRequest({
        identityMode: 'anonymous',
        request: input.request,
      });
      return await this.database.transaction(async (transaction) => {
        await this.beginAnonymousLeaseOwnership(transaction, lease, input.now);
        const result = await this.createInsideTransaction(transaction, {
          identityMode: 'anonymous',
          request: input.request,
          routing: { state: 'unassigned' },
          requestDigest,
          correlationId: input.correlationId,
          now: input.now,
        });
        await this.renewAnonymousLeaseOwnership(transaction, lease, input.now);
        return result;
      });
    } finally {
      await this.database.query(
        `DELETE FROM feedback_anonymous_processing_leases
         WHERE id = $1 AND client_key_hmac = $2`,
        [lease.id, lease.networkHmac],
      );
    }
  }

  async convertSupportCase(input: {
    readonly householdId: string;
    readonly supportCaseId: string;
    readonly actorPersonId: string;
    readonly request: SupportFeedbackConversionInput;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<FeedbackIntakeResult> {
    assertCommonInput({ ...input.request, correlationId: input.correlationId, now: input.now });
    for (const value of [input.householdId, input.supportCaseId, input.actorPersonId]) {
      if (!stableIdPattern.test(value)) {
        throw new DomainError('invalid_input', 'Support feedback scope is invalid');
      }
    }
    assertFeedbackSourceCompatible({
      identityMode: 'support_conversion',
      sourceSurface: input.request.source.surface,
    });
    const requestDigest = this.digestRequest({
      identityMode: 'support_conversion',
      householdId: input.householdId,
      actorPersonId: input.actorPersonId,
      supportCaseId: input.supportCaseId,
      request: input.request,
    });
    return this.database.transaction(async (transaction) => {
      await this.lockFeedbackReviewMutex(transaction);
      const supportAssignmentId = await this.exactSupportAssignment(transaction, input);
      const minimized = minimizeSubmittedFeedbackText(input.request.text);
      const unsafe = minimized.status === 'rejected';
      return this.createInsideTransaction(transaction, {
        identityMode: 'support_conversion',
        householdId: input.householdId,
        actorPersonId: input.actorPersonId,
        supportCaseId: input.supportCaseId,
        request: input.request,
        routing: unsafe
          ? { state: 'unassigned' }
          : {
              state: 'assigned',
              assignmentId: supportAssignmentId,
              assignmentActorPersonId: input.actorPersonId,
            },
        requestDigest,
        correlationId: input.correlationId,
        now: input.now,
      });
    });
  }

  async roleScopedMetadata(input: {
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<readonly HqFeedbackQueueItem[]> {
    if (
      !stableIdPattern.test(input.actorPersonId) ||
      !correlationPattern.test(input.correlationId) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Feedback queue access is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const tentative = await this.currentInternalAssignments(transaction, input.actorPersonId);
      const tentativeOwnerProjection = tentative.some(
        (assignment) => assignment.role === 'hq_owner',
      );
      await this.lockFeedbackReviewMutex(transaction);
      await transaction.query(
        `SELECT record.id
         FROM feedback_records record
         JOIN LATERAL (
           SELECT event.* FROM feedback_assignment_events event
           WHERE event.feedback_id = record.id ORDER BY event.version DESC LIMIT 1
         ) assignment ON true
         LEFT JOIN employee_assignments assignee
           ON assignee.id = assignment.employee_assignment_id
         LEFT JOIN organizations organization ON organization.id = assignee.organization_id
         WHERE $2::boolean OR (
           assignment.routing_state = 'assigned' AND assignee.person_id = $1
           AND assignee.status = 'active' AND organization.kind = 'internal'
           AND assignee.role IN ('hq_owner', 'hq_reviewer', 'hq_support')
           AND (
             record.identity_mode <> 'support_conversion'
             OR EXISTS (
               SELECT 1
               FROM support_cases support_case
               JOIN support_case_assignments support_assignment
                 ON support_assignment.household_id = support_case.household_id
                AND support_assignment.case_id = support_case.id
               WHERE support_case.household_id = record.household_id
                 AND support_case.id = record.linked_object_id
                 AND support_case.status = 'open'
                 AND support_assignment.employee_assignment_id = assignment.employee_assignment_id
                 AND support_assignment.status = 'active'
             )
           )
         )
         ORDER BY assignment.occurred_at DESC, record.id DESC
         LIMIT 100 FOR UPDATE OF record`,
        [input.actorPersonId, tentativeOwnerProjection],
      );
      const employee = await this.lockInternalAssignments(transaction, input.actorPersonId);
      const ownerProjection = employee.some((assignment) => assignment.role === 'hq_owner');
      if (tentativeOwnerProjection !== ownerProjection) {
        throw new DomainError(
          'conflict',
          'Feedback review authority changed while the projection was opening',
        );
      }
      await this.lockCurrentSupportVisibility(transaction, input.actorPersonId);
      const authorityNow = await this.authorityNow(transaction, input.now);
      const result = await transaction.query<HqFeedbackRow>(
        `SELECT record.id, record.identity_mode, record.household_id, record.source_surface,
                record.feedback_type, state.to_status, state.severity, state.classification,
                assignment.queue, assignment.routing_state, payload.redaction_status,
                state.duplicate_of_feedback_id,
                state.cluster_id, state.resulting_action_type, state.resulting_action_id,
                state.close_loop_state, record.evidence_tier, state.version, record.created_at,
                assignment.occurred_at AS routed_at,
                CASE WHEN assignment.routing_state = 'assigned'
                  THEN assignment.occurred_at ELSE NULL END AS assigned_at,
                COALESCE((SELECT consent.state = 'granted'
                  FROM feedback_consent_events consent
                  WHERE consent.feedback_id = record.id AND consent.purpose = 'follow_up'
                  ORDER BY consent.sequence DESC LIMIT 1), false) AS follow_up_consented,
                COALESCE((SELECT consent.state = 'granted'
                  FROM feedback_consent_events consent
                  WHERE consent.feedback_id = record.id AND consent.purpose = 'research_retention'
                  ORDER BY consent.sequence DESC LIMIT 1), false) AS research_retention_consented,
                COALESCE((assignment.routing_state = 'assigned' AND assignee.person_id = $1
                  AND assignee.status = 'active' AND organization.kind = 'internal'
                  AND payload.payload_state = 'encrypted_minimized'
                  AND payload.retention_deadline > $3
                  AND state.to_status = ANY($4::text[])
                  AND (record.identity_mode <> 'support_conversion'
                    OR support_visibility.currently_assigned = true)
                ), false) AS content_read_authorized,
                ($2::boolean AND record.identity_mode <> 'support_conversion'
                  AND payload.payload_state = 'encrypted_minimized'
                  AND payload.retention_deadline > $3
                  AND state.to_status = ANY($4::text[])
                  AND NOT (assignment.routing_state = 'assigned'
                    AND assignee.person_id = $1 AND assignee.status = 'active'
                    AND organization.kind = 'internal')
                ) AS self_claim_available
         FROM feedback_records record
         JOIN LATERAL (
           SELECT event.* FROM feedback_state_events event
           WHERE event.feedback_id = record.id ORDER BY event.version DESC LIMIT 1
         ) state ON true
         JOIN LATERAL (
           SELECT event.* FROM feedback_assignment_events event
           WHERE event.feedback_id = record.id ORDER BY event.version DESC LIMIT 1
         ) assignment ON true
         LEFT JOIN employee_assignments assignee ON assignee.id = assignment.employee_assignment_id
         LEFT JOIN organizations organization ON organization.id = assignee.organization_id
         JOIN feedback_payloads payload ON payload.feedback_id = record.id
         LEFT JOIN LATERAL (
           SELECT true AS currently_assigned
           FROM support_cases support_case
           JOIN support_case_assignments support_assignment
             ON support_assignment.household_id = support_case.household_id
            AND support_assignment.case_id = support_case.id
           WHERE support_case.household_id = record.household_id
             AND support_case.id = record.linked_object_id
             AND support_case.status = 'open'
             AND support_assignment.employee_assignment_id = assignment.employee_assignment_id
             AND support_assignment.status = 'active'
           LIMIT 1
         ) support_visibility ON record.identity_mode = 'support_conversion'
         WHERE $2::boolean OR (
           assignment.routing_state = 'assigned' AND assignee.person_id = $1
           AND assignee.status = 'active' AND organization.kind = 'internal'
           AND assignee.role IN ('hq_owner', 'hq_reviewer', 'hq_support')
           AND (
             record.identity_mode <> 'support_conversion'
             OR support_visibility.currently_assigned = true
           )
         )
         ORDER BY assignment.occurred_at DESC, record.id DESC
         LIMIT 100`,
        [
          input.actorPersonId,
          ownerProjection,
          authorityNow.toISOString(),
          [...feedbackContentReadableStatuses],
        ],
      );
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,NULL,$2,'hq','feedback.queue.read','feedback_queue',NULL,'allowed',
           $3::jsonb,$4,$5)`,
        [
          this.ids.next('audit'),
          input.actorPersonId,
          jsonParameter({
            projection: ownerProjection
              ? 'owner_global_feedback_metadata'
              : 'exact_assigned_feedback_metadata',
            rowCount: result.rowCount,
          }),
          input.correlationId,
          authorityNow.toISOString(),
        ],
      );
      return result.rows.map((row) => ({
        id: row.id,
        identityMode: row.identity_mode,
        ...(row.household_id === null ? {} : { householdId: row.household_id }),
        sourceSurface: row.source_surface,
        feedbackType: row.feedback_type,
        status: row.to_status,
        severity: row.severity,
        classification: row.classification,
        queue: row.queue,
        routingState: row.routing_state,
        redactionStatus: row.redaction_status,
        ...(row.duplicate_of_feedback_id === null
          ? {}
          : { duplicateOfFeedbackId: row.duplicate_of_feedback_id }),
        ...(row.cluster_id === null ? {} : { clusterId: row.cluster_id }),
        ...(row.resulting_action_type === null
          ? {}
          : { resultingActionType: row.resulting_action_type }),
        ...(row.resulting_action_id === null ? {} : { resultingActionId: row.resulting_action_id }),
        closeLoopState: row.close_loop_state,
        followUpConsented: row.follow_up_consented,
        researchRetentionConsented: row.research_retention_consented,
        evidenceTier: row.evidence_tier,
        version: row.version,
        createdAt: asDate(row.created_at, 'feedback_records.created_at'),
        routedAt: asDate(row.routed_at, 'feedback_assignment_events.occurred_at'),
        ...(row.assigned_at === null
          ? {}
          : { assignedAt: asDate(row.assigned_at, 'feedback_assignment_events.occurred_at') }),
        contentReadAuthorized: row.content_read_authorized,
        selfClaimAvailable: row.self_claim_available,
      }));
    });
  }

  async claimForReview(input: {
    readonly feedbackId: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<FeedbackReviewClaimResult> {
    if (
      !stableIdPattern.test(input.feedbackId) ||
      !stableIdPattern.test(input.actorPersonId) ||
      !correlationPattern.test(input.correlationId) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Feedback review claim scope is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const tentativeAssignments = await this.currentInternalAssignments(
        transaction,
        input.actorPersonId,
      );
      if (!tentativeAssignments.some((assignment) => assignment.role === 'hq_owner')) {
        throw new DomainError(
          'not_authorized',
          'Only a current internal owner may self-claim feedback review',
        );
      }
      await this.lockFeedbackReviewMutex(transaction);
      const record = await transaction.query<
        {
          readonly identity_mode: FeedbackIdentityMode;
          readonly household_id: string | null;
          readonly payload_state: string;
          readonly retention_deadline: unknown | null;
        } & Record<string, unknown>
      >(
        `SELECT record.identity_mode, record.household_id, payload.payload_state,
                payload.retention_deadline
         FROM feedback_records record
         JOIN feedback_payloads payload ON payload.feedback_id = record.id
         WHERE record.id = $1
         FOR UPDATE OF record, payload`,
        [input.feedbackId],
      );
      const durable = record.rows[0];
      if (
        durable === undefined ||
        durable.identity_mode === 'support_conversion' ||
        durable.payload_state !== 'encrypted_minimized' ||
        durable.retention_deadline === null
      ) {
        throw new DomainError(
          'not_authorized',
          'Feedback is unavailable for owner self-claim review',
        );
      }
      const internalAssignments = await this.lockInternalAssignments(
        transaction,
        input.actorPersonId,
      );
      const ownerAssignment = internalAssignments.find(
        (assignment) => assignment.role === 'hq_owner',
      );
      if (ownerAssignment === undefined) {
        throw new DomainError(
          'not_authorized',
          'Only a current internal owner may self-claim feedback review',
        );
      }
      const stateResult = await transaction.query<
        {
          readonly version: number;
          readonly to_status: FeedbackStatus;
          readonly severity: FeedbackSeverity;
          readonly classification: FeedbackClassification;
          readonly duplicate_of_feedback_id: string | null;
          readonly cluster_id: string | null;
          readonly customer_impact_code: string | null;
          readonly resulting_action_type:
            'issue' | 'experiment' | 'content' | 'support_action' | null;
          readonly resulting_action_id: string | null;
          readonly close_loop_state: FeedbackCloseLoopState;
        } & Record<string, unknown>
      >(
        `SELECT version, to_status, severity, classification, duplicate_of_feedback_id,
                cluster_id, customer_impact_code, resulting_action_type,
                resulting_action_id, close_loop_state
         FROM feedback_state_events WHERE feedback_id = $1
         ORDER BY version DESC LIMIT 1`,
        [input.feedbackId],
      );
      const routingResult = await transaction.query<
        {
          readonly version: number;
          readonly routing_state: FeedbackRoutingState;
          readonly queue: FeedbackQueue;
          readonly employee_assignment_id: string | null;
        } & Record<string, unknown>
      >(
        `SELECT version, routing_state, queue, employee_assignment_id
         FROM feedback_assignment_events WHERE feedback_id = $1
         ORDER BY version DESC LIMIT 1`,
        [input.feedbackId],
      );
      const state = stateResult.rows[0];
      const routing = routingResult.rows[0];
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (
        state === undefined ||
        routing === undefined ||
        !isFeedbackContentReadableStatus(state.to_status) ||
        asDate(durable.retention_deadline, 'feedback retention deadline') <= authorityNow
      ) {
        throw new DomainError('conflict', 'Feedback is not in a review-claimable state');
      }
      const alreadyAssignedToActor =
        routing.routing_state === 'assigned' &&
        routing.employee_assignment_id !== null &&
        internalAssignments.some((assignment) => assignment.id === routing.employee_assignment_id);
      let assignmentVersion = routing.version;
      if (!alreadyAssignedToActor) {
        assignmentVersion += 1;
        await transaction.query(
          `INSERT INTO feedback_assignment_events(
             id, feedback_id, version, routing_state, queue, employee_assignment_id,
             assigned_by_person_id, service_key, reason_code, occurred_at
           ) VALUES ($1,$2,$3,'assigned',$4,$5,$6,NULL,'owner_self_claim',$7)`,
          [
            this.ids.next('feedback-assignment'),
            input.feedbackId,
            assignmentVersion,
            routing.queue,
            ownerAssignment.id,
            input.actorPersonId,
            authorityNow.toISOString(),
          ],
        );
        if (state.to_status !== 'assigned') {
          await this.insertState(transaction, {
            feedbackId: input.feedbackId,
            version: state.version + 1,
            fromStatus: state.to_status,
            toStatus: 'assigned',
            actor: { kind: 'hq', personId: input.actorPersonId },
            reasonCode: 'owner_self_claim',
            severity: state.severity,
            classification: state.classification,
            ...(state.duplicate_of_feedback_id === null
              ? {}
              : { duplicateOfFeedbackId: state.duplicate_of_feedback_id }),
            ...(state.cluster_id === null ? {} : { clusterId: state.cluster_id }),
            ...(state.customer_impact_code === null
              ? {}
              : { customerImpactCode: state.customer_impact_code }),
            ...(state.resulting_action_type === null
              ? {}
              : { resultingActionType: state.resulting_action_type }),
            ...(state.resulting_action_id === null
              ? {}
              : { resultingActionId: state.resulting_action_id }),
            closeLoopState: 'human_review_required',
            now: authorityNow,
          });
        }
      }
      const humanReviewRequired =
        state.to_status === 'assigned' ? state.close_loop_state === 'human_review_required' : true;
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,'hq','feedback.review.self_claim','feedback',$4,'allowed',
           $5::jsonb,$6,$7)`,
        [
          this.ids.next('audit'),
          durable.household_id,
          input.actorPersonId,
          input.feedbackId,
          jsonParameter({
            assignmentVersion,
            reused: alreadyAssignedToActor,
            contentIncluded: false,
            humanReviewRequired,
          }),
          input.correlationId,
          authorityNow.toISOString(),
        ],
      );
      return {
        feedbackId: input.feedbackId,
        queue: routing.queue,
        assignmentVersion,
        humanReviewRequired,
        reused: alreadyAssignedToActor,
        evidenceTier: 'local_simulation',
        externalActionExecuted: false,
      };
    });
  }

  async readAssignedMinimizedText(input: {
    readonly feedbackId: string;
    readonly actorPersonId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<AssignedFeedbackContent> {
    if (
      !stableIdPattern.test(input.feedbackId) ||
      !stableIdPattern.test(input.actorPersonId) ||
      !correlationPattern.test(input.correlationId) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Assigned feedback read scope is invalid');
    }
    return this.database.transaction(async (transaction) => {
      await this.currentInternalAssignments(transaction, input.actorPersonId);
      await this.lockFeedbackReviewMutex(transaction);
      const recordResult = await transaction.query<
        {
          readonly identity_mode: FeedbackIdentityMode;
          readonly household_id: string | null;
          readonly linked_object_id: string | null;
          readonly payload_state: string;
          readonly encrypted_text: string | null;
          readonly encryption_key_version: number | null;
          readonly redaction_status: FeedbackIntakeResult['redactionStatus'];
          readonly retention_deadline: unknown | null;
        } & Record<string, unknown>
      >(
        `SELECT record.identity_mode, record.household_id, record.linked_object_id,
                payload.payload_state, payload.encrypted_text, payload.encryption_key_version,
                payload.redaction_status, payload.retention_deadline
         FROM feedback_records record
         JOIN feedback_payloads payload ON payload.feedback_id = record.id
         WHERE record.id = $1
         FOR UPDATE OF record, payload`,
        [input.feedbackId],
      );
      const internalAssignments = await this.lockInternalAssignments(
        transaction,
        input.actorPersonId,
      );
      const record = recordResult.rows[0];
      const assignmentResult = await transaction.query<
        {
          readonly routing_state: FeedbackRoutingState;
          readonly employee_assignment_id: string | null;
        } & Record<string, unknown>
      >(
        `SELECT routing_state, employee_assignment_id
         FROM feedback_assignment_events WHERE feedback_id = $1
         ORDER BY version DESC LIMIT 1`,
        [input.feedbackId],
      );
      const assignment = assignmentResult.rows[0];
      if (
        record === undefined ||
        assignment === undefined ||
        assignment.routing_state !== 'assigned' ||
        assignment.employee_assignment_id === null ||
        !internalAssignments.some((item) => item.id === assignment.employee_assignment_id) ||
        record.payload_state !== 'encrypted_minimized' ||
        record.encrypted_text === null ||
        record.encryption_key_version !== this.protection.encryptionKeyVersion ||
        record.retention_deadline === null ||
        record.redaction_status === 'quarantined_discarded'
      ) {
        throw new DomainError(
          'not_authorized',
          'Assigned minimized feedback content is unavailable',
        );
      }
      if (record.identity_mode === 'support_conversion') {
        const supportVisibility = await transaction.query(
          `SELECT support_assignment.employee_assignment_id
           FROM support_cases support_case
           JOIN support_case_assignments support_assignment
             ON support_assignment.household_id = support_case.household_id
            AND support_assignment.case_id = support_case.id
           JOIN employee_assignments employee
             ON employee.id = support_assignment.employee_assignment_id
           JOIN organizations organization ON organization.id = employee.organization_id
           WHERE support_case.household_id = $1 AND support_case.id = $2
             AND support_case.status = 'open' AND support_assignment.status = 'active'
             AND support_assignment.employee_assignment_id = $3
             AND employee.person_id = $4 AND employee.role = 'hq_support'
             AND employee.status = 'active' AND organization.kind = 'internal'
           FOR UPDATE OF support_case, support_assignment, employee, organization`,
          [
            record.household_id,
            record.linked_object_id,
            assignment.employee_assignment_id,
            input.actorPersonId,
          ],
        );
        if (supportVisibility.rowCount !== 1) {
          throw new DomainError(
            'not_authorized',
            'Assigned minimized feedback content is unavailable',
          );
        }
      }
      const stateResult = await transaction.query<
        { readonly to_status: FeedbackStatus } & Record<string, unknown>
      >(
        `SELECT state_event.to_status
         FROM feedback_state_events state_event
         WHERE state_event.feedback_id = $1
         ORDER BY state_event.version DESC LIMIT 1`,
        [input.feedbackId],
      );
      const latestState = stateResult.rows[0];
      const authorityNow = await this.authorityNow(transaction, input.now);
      if (
        latestState === undefined ||
        !isFeedbackContentReadableStatus(latestState.to_status) ||
        asDate(record.retention_deadline, 'feedback retention deadline') <= authorityNow
      ) {
        throw new DomainError(
          'not_authorized',
          'Assigned minimized feedback content is unavailable',
        );
      }
      let plaintext: string;
      try {
        plaintext = decryptField(
          parseEncryptedField(record.encrypted_text),
          this.protection.encryptionKey,
          {
            tenantId: record.household_id ?? 'anonymous_feedback',
            resourceId: input.feedbackId,
            field: 'minimized_text',
            schemaVersion: 1,
            keyVersion: record.encryption_key_version,
          },
        ).toString('utf8');
      } catch {
        throw new DomainError('conflict', 'Assigned minimized feedback content is unreadable');
      }
      const verified = verifyRetainedMinimizedFeedbackText(plaintext);
      if (
        verified.status !== 'accepted' ||
        verified.redactions.length !== 0 ||
        verified.minimized !== plaintext
      ) {
        throw new DomainError(
          'restricted_input',
          'Assigned feedback failed deterministic redaction verification',
        );
      }
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,'hq','feedback.content.read','feedback',$4,'allowed',
           $5::jsonb,$6,$7)`,
        [
          this.ids.next('audit'),
          record.household_id,
          input.actorPersonId,
          input.feedbackId,
          jsonParameter({
            projection: 'exact_assigned_minimized_text',
            purpose: 'feedback_triage',
            redactionStatus: record.redaction_status,
            deterministicRedactionVerification: 'passed',
            providerProcessed: false,
            externalActionExecuted: false,
          }),
          input.correlationId,
          authorityNow.toISOString(),
        ],
      );
      return {
        feedbackId: input.feedbackId,
        minimizedText: plaintext,
        redactionStatus: record.redaction_status,
        evidenceTier: 'local_simulation',
        contentBoundary: 'assigned_minimized_text',
        externalActionExecuted: false,
      };
    });
  }

  private async eraseActiveStoreCiphertext(
    executor: SqlExecutor,
    input: {
      readonly feedbackId: string;
      readonly reason: 'consent_withdrawn' | 'retention_expired';
      readonly actorPersonId?: string;
      readonly now: Date;
    },
  ): Promise<boolean> {
    const erased = await executor.query<
      { readonly retention_deadline: unknown } & Record<string, unknown>
    >(
      `UPDATE feedback_payloads
       SET payload_state = 'payload_erased', encrypted_text = NULL,
           encryption_key_version = NULL, erased_at = $2
       WHERE feedback_id = $1 AND payload_state = 'encrypted_minimized'
       RETURNING retention_deadline`,
      [input.feedbackId, input.now.toISOString()],
    );
    const row = erased.rows[0];
    if (row === undefined) return false;
    await executor.query(
      `INSERT INTO feedback_payload_erasure_events(
         id, feedback_id, reason, actor_kind, actor_person_id, prior_retention_deadline,
         evidence_tier, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'local_simulation',$7)`,
      [
        this.ids.next('feedback-erasure'),
        input.feedbackId,
        input.reason,
        input.actorPersonId === undefined ? 'system' : 'participant',
        input.actorPersonId ?? null,
        asDate(row.retention_deadline, 'feedback retention deadline').toISOString(),
        input.now.toISOString(),
      ],
    );
    return true;
  }

  async withdrawAuthenticatedConsent(input: {
    readonly feedbackId: string;
    readonly householdId: string;
    readonly actorPersonId: string;
    readonly purpose: 'follow_up' | 'research_retention' | 'object_linkage';
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<{
    readonly withdrawn: boolean;
    readonly activeStoreCiphertextErased: boolean;
  }> {
    if (
      !stableIdPattern.test(input.feedbackId) ||
      !stableIdPattern.test(input.householdId) ||
      !stableIdPattern.test(input.actorPersonId) ||
      !correlationPattern.test(input.correlationId) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Feedback consent withdrawal scope is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const record = await transaction.query<
        {
          readonly version: number;
          readonly to_status: FeedbackStatus;
          readonly severity: FeedbackSeverity;
          readonly classification: FeedbackClassification;
          readonly duplicate_of_feedback_id: string | null;
          readonly cluster_id: string | null;
          readonly customer_impact_code: string | null;
          readonly resulting_action_type:
            'issue' | 'experiment' | 'content' | 'support_action' | null;
          readonly resulting_action_id: string | null;
          readonly close_loop_state: FeedbackCloseLoopState;
        } & Record<string, unknown>
      >(
        `SELECT state.version, state.to_status, state.severity, state.classification,
                state.duplicate_of_feedback_id, state.cluster_id, state.customer_impact_code,
                state.resulting_action_type, state.resulting_action_id, state.close_loop_state
         FROM feedback_records record
         JOIN LATERAL (
           SELECT event.* FROM feedback_state_events event
           WHERE event.feedback_id = record.id ORDER BY event.version DESC LIMIT 1
         ) state ON true
         WHERE record.id = $1 AND record.identity_mode = 'authenticated'
           AND record.household_id = $2 AND record.actor_person_id = $3
         FOR UPDATE OF record`,
        [input.feedbackId, input.householdId, input.actorPersonId],
      );
      const current = record.rows[0];
      if (current === undefined) {
        throw new DomainError('not_authorized', 'Feedback consent authority is unavailable');
      }
      const latest = await transaction.query<
        { readonly sequence: number; readonly state: string } & Record<string, unknown>
      >(
        `SELECT sequence, state FROM feedback_consent_events
         WHERE feedback_id = $1 AND purpose = $2 ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
        [input.feedbackId, input.purpose],
      );
      const consent = latest.rows[0];
      if (consent === undefined || consent.state !== 'granted') {
        return { withdrawn: false, activeStoreCiphertextErased: false };
      }
      const authorityNow = await this.authorityNow(transaction, input.now);
      await transaction.query(
        `INSERT INTO feedback_consent_events(
           id, feedback_id, purpose, sequence, state, purpose_code, consent_version,
           channel_class, retain_until, actor_kind, actor_person_id, reason_code, occurred_at
         ) VALUES ($1,$2,$3,$4,'withdrawn',NULL,NULL,NULL,NULL,'participant',$5,
           'participant_withdrew',$6)`,
        [
          this.ids.next('feedback-consent'),
          input.feedbackId,
          input.purpose,
          consent.sequence + 1,
          input.actorPersonId,
          authorityNow.toISOString(),
        ],
      );
      if (input.purpose === 'object_linkage') {
        await transaction.query(
          `UPDATE feedback_records
           SET linked_object_type = NULL, linked_object_id = NULL,
               linkage_consent_version = NULL
           WHERE id = $1 AND linked_object_id IS NOT NULL`,
          [input.feedbackId],
        );
      }
      const erased = await this.eraseActiveStoreCiphertext(transaction, {
        feedbackId: input.feedbackId,
        reason: 'consent_withdrawn',
        actorPersonId: input.actorPersonId,
        now: authorityNow,
      });
      if (
        erased &&
        !['closed', 'retention_expired', 'unsafe_unprocessable', 'withdrawn'].includes(
          current.to_status,
        )
      ) {
        await this.insertState(transaction, {
          feedbackId: input.feedbackId,
          version: current.version + 1,
          fromStatus: current.to_status,
          toStatus: 'withdrawn',
          actor: { kind: 'participant', personId: input.actorPersonId },
          reasonCode: 'participant_withdrew_optional_purpose',
          severity: current.severity,
          classification: current.classification,
          ...(current.duplicate_of_feedback_id === null
            ? {}
            : { duplicateOfFeedbackId: current.duplicate_of_feedback_id }),
          ...(current.cluster_id === null ? {} : { clusterId: current.cluster_id }),
          ...(current.customer_impact_code === null
            ? {}
            : { customerImpactCode: current.customer_impact_code }),
          ...(current.resulting_action_type === null
            ? {}
            : { resultingActionType: current.resulting_action_type }),
          ...(current.resulting_action_id === null
            ? {}
            : { resultingActionId: current.resulting_action_id }),
          closeLoopState: current.close_loop_state,
          now: authorityNow,
        });
      }
      await transaction.query(
        `INSERT INTO audit_events(
           id, household_id, actor_person_id, session_audience, action, resource_type,
           resource_id, outcome, metadata, correlation_id, occurred_at
         ) VALUES ($1,$2,$3,'customer','feedback.consent.withdraw','feedback',$4,'completed',
           $5::jsonb,$6,$7)`,
        [
          this.ids.next('audit'),
          input.householdId,
          input.actorPersonId,
          input.feedbackId,
          jsonParameter({ purpose: input.purpose, activeStoreCiphertextErased: erased }),
          input.correlationId,
          authorityNow.toISOString(),
        ],
      );
      return { withdrawn: true, activeStoreCiphertextErased: erased };
    });
  }

  async purgeDue(input: { readonly now: Date; readonly limit: number }): Promise<number> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new DomainError('invalid_input', 'Feedback retention batch limit is invalid');
    }
    return this.database.transaction(async (transaction) => {
      const candidates = await transaction.query<
        {
          readonly feedback_id: string;
          readonly retention_deadline: unknown;
        } & Record<string, unknown>
      >(
        `SELECT record.id AS feedback_id, payload.retention_deadline
         FROM feedback_records record
         JOIN feedback_payloads payload ON payload.feedback_id = record.id
         WHERE payload.payload_state = 'encrypted_minimized'
         ORDER BY payload.retention_deadline, record.id
         LIMIT $1 FOR UPDATE OF record, payload SKIP LOCKED`,
        [input.limit],
      );
      const authorityNow = await this.authorityNow(transaction, input.now);
      const dueFeedbackIds = candidates.rows
        .filter(
          (candidate) =>
            asDate(candidate.retention_deadline, 'feedback retention deadline') <= authorityNow,
        )
        .map((candidate) => candidate.feedback_id);
      let erasedCount = 0;
      for (const feedbackId of dueFeedbackIds) {
        const latest = await transaction.query<
          {
            readonly feedback_id: string;
            readonly version: number;
            readonly to_status: FeedbackStatus;
            readonly severity: FeedbackSeverity;
            readonly classification: FeedbackClassification;
            readonly duplicate_of_feedback_id: string | null;
            readonly cluster_id: string | null;
            readonly customer_impact_code: string | null;
            readonly resulting_action_type:
              'issue' | 'experiment' | 'content' | 'support_action' | null;
            readonly resulting_action_id: string | null;
            readonly close_loop_state: FeedbackCloseLoopState;
          } & Record<string, unknown>
        >(
          `SELECT record.id AS feedback_id, state.version, state.to_status, state.severity,
                state.classification, state.duplicate_of_feedback_id, state.cluster_id,
                state.customer_impact_code, state.resulting_action_type,
                state.resulting_action_id, state.close_loop_state
         FROM feedback_records record
         JOIN feedback_payloads payload ON payload.feedback_id = record.id
         JOIN LATERAL (
           SELECT event.* FROM feedback_state_events event
           WHERE event.feedback_id = record.id ORDER BY event.version DESC LIMIT 1
         ) state ON true
         WHERE record.id = $1 AND payload.payload_state = 'encrypted_minimized'
           AND payload.retention_deadline <= $2`,
          [feedbackId, authorityNow.toISOString()],
        );
        const row = latest.rows[0];
        if (row === undefined) continue;
        const latestConsents = await transaction.query<
          {
            readonly purpose: 'follow_up' | 'research_retention' | 'object_linkage';
            readonly sequence: number;
            readonly state: string;
          } & Record<string, unknown>
        >(
          `SELECT DISTINCT ON (purpose) purpose, sequence, state
           FROM feedback_consent_events WHERE feedback_id = $1
           ORDER BY purpose, sequence DESC`,
          [row.feedback_id],
        );
        let linkageExpired = false;
        for (const consent of latestConsents.rows.filter((item) => item.state === 'granted')) {
          await transaction.query(
            `INSERT INTO feedback_consent_events(
               id, feedback_id, purpose, sequence, state, purpose_code, consent_version,
               channel_class, retain_until, actor_kind, actor_person_id, reason_code, occurred_at
             ) VALUES ($1,$2,$3,$4,'expired',NULL,NULL,NULL,NULL,'system',NULL,
               'local_retention_deadline_reached',$5)`,
            [
              this.ids.next('feedback-consent'),
              row.feedback_id,
              consent.purpose,
              consent.sequence + 1,
              authorityNow.toISOString(),
            ],
          );
          linkageExpired ||= consent.purpose === 'object_linkage';
        }
        if (linkageExpired) {
          await transaction.query(
            `UPDATE feedback_records
             SET linked_object_type = NULL, linked_object_id = NULL,
                 linkage_consent_version = NULL
             WHERE id = $1 AND linked_object_id IS NOT NULL`,
            [row.feedback_id],
          );
        }
        const erased = await this.eraseActiveStoreCiphertext(transaction, {
          feedbackId: row.feedback_id,
          reason: 'retention_expired',
          now: authorityNow,
        });
        if (erased) erasedCount += 1;
        if (
          erased &&
          !['closed', 'retention_expired', 'unsafe_unprocessable'].includes(row.to_status)
        ) {
          await this.insertState(transaction, {
            feedbackId: row.feedback_id,
            version: row.version + 1,
            fromStatus: row.to_status,
            toStatus: 'retention_expired',
            actor: { kind: 'system', serviceKey: 'feedback.retention' },
            reasonCode: 'local_retention_deadline_reached',
            severity: row.severity,
            classification: row.classification,
            ...(row.duplicate_of_feedback_id === null
              ? {}
              : { duplicateOfFeedbackId: row.duplicate_of_feedback_id }),
            ...(row.cluster_id === null ? {} : { clusterId: row.cluster_id }),
            ...(row.customer_impact_code === null
              ? {}
              : { customerImpactCode: row.customer_impact_code }),
            ...(row.resulting_action_type === null
              ? {}
              : { resultingActionType: row.resulting_action_type }),
            ...(row.resulting_action_id === null
              ? {}
              : { resultingActionId: row.resulting_action_id }),
            closeLoopState: row.close_loop_state,
            now: authorityNow,
          });
        }
      }
      await transaction.query(
        `DELETE FROM feedback_anonymous_quota_buckets WHERE bucket_start < $1`,
        [new Date(authorityNow.getTime() - 2 * 3_600_000).toISOString()],
      );
      await transaction.query(
        `DELETE FROM feedback_anonymous_processing_leases WHERE expires_at <= $1`,
        [authorityNow.toISOString()],
      );
      return erasedCount;
    });
  }
}
