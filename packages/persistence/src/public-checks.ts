import { createHmac, randomBytes } from 'node:crypto';
import { DomainError, type Audience } from '@boomerbuddy/domain';
import {
  constantTimeEqual,
  decryptField,
  encryptField,
  lengthPrefixed,
  minimizeRestrictedInput,
  parseEncryptedField,
  serializeEncryptedField,
  type SafeRedaction,
  type SensitiveSafetyFlag,
} from '@boomerbuddy/security';
import type { CheckRepository, DecisionRecord, StoredCheck } from './checks';
import type { Database, SqlExecutor } from './database';
import { writeAuditAndOutbox } from './events';
import { asDate, randomIdFactory, type IdFactory } from './values';

export type PublicAttributionSource = 'direct' | 'organic' | 'partner' | 'campaign';
export type PublicAttributionCampaign = 'none' | 'launch_2026' | 'trusted_partner';
// Anonymous grant rows are physically removed 24 hours after their terminal expiry.
const anonymousTerminalRetentionMs = 24 * 60 * 60_000;

export interface PublicCheckProtection {
  readonly encryptionKey: Uint8Array;
  readonly encryptionKeyVersion: number;
  readonly hmacKey: Uint8Array;
  readonly hmacKeyVersion: number;
}

export interface PublicCheckContextGrant {
  readonly token: string;
  readonly expiresAt: Date;
  readonly remainingChecks: number;
}

export interface PublicCheckAttribution {
  readonly source: PublicAttributionSource;
  readonly campaign: PublicAttributionCampaign;
}

export interface PublicCheckInteraction extends PublicCheckAttribution {
  readonly contextId: string;
}

export interface PublicCheckPayload {
  readonly kind: 'text' | 'url';
  readonly redactedContent: string;
  readonly decision: DecisionRecord;
  readonly inputSafety: {
    readonly redactions: readonly SafeRedaction[];
    readonly flags: readonly SensitiveSafetyFlag[];
  };
}

export interface PublicCheckResultGrant {
  readonly id: string;
  readonly conversionToken: string;
  readonly expiresAt: Date;
}

interface ContextRow extends Record<string, unknown> {
  readonly id: string;
  readonly token_hmac: string;
  readonly client_key_hmac: string;
  readonly remaining_checks: number;
  readonly state: 'active' | 'exhausted' | 'expired';
  readonly attribution_source: PublicAttributionSource;
  readonly attribution_campaign: PublicAttributionCampaign;
  readonly expires_at: unknown;
}

interface ResultRow extends Record<string, unknown> {
  readonly id: string;
  readonly conversion_hmac: string | null;
  readonly encrypted_payload: string | null;
  readonly state: 'active' | 'consumed' | 'expired';
  readonly expires_at: unknown;
  readonly context_id: string | null;
  readonly attribution_source: PublicAttributionSource | null;
  readonly attribution_campaign: PublicAttributionCampaign | null;
}

interface ConversionRow extends Record<string, unknown> {
  readonly result_id: string;
  readonly actor_person_id: string;
  readonly household_id: string;
  readonly analysis_id: string;
  readonly save_consent: boolean;
  readonly consent_version: string;
  readonly session_audience: 'customer' | 'mobile';
  readonly credential_hmac: string;
}

function assertProtection(protection: PublicCheckProtection): void {
  if (protection.encryptionKey.byteLength !== 32 || protection.hmacKey.byteLength < 32) {
    throw new TypeError('Public Check encryption and HMAC keys must contain at least 32 bytes');
  }
  if (
    !Number.isSafeInteger(protection.encryptionKeyVersion) ||
    protection.encryptionKeyVersion < 1 ||
    !Number.isSafeInteger(protection.hmacKeyVersion) ||
    protection.hmacKeyVersion < 1
  ) {
    throw new TypeError('Public Check key versions must be positive safe integers');
  }
}

function mintToken(id: string): { readonly token: string; readonly secret: string } {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${id}.${secret}`, secret };
}

function parseToken(
  token: string,
  expectedPrefix: string,
): { readonly id: string; readonly secret: string } {
  const separator = token.lastIndexOf('.');
  const id = separator < 0 ? '' : token.slice(0, separator);
  const secret = separator < 0 ? '' : token.slice(separator + 1);
  if (
    !id.startsWith(`${expectedPrefix}_`) ||
    !/^[A-Za-z0-9_-]{12,128}$/u.test(id) ||
    !/^[A-Za-z0-9_-]{32,128}$/u.test(secret)
  ) {
    throw new DomainError('not_found', 'Public Check grant is invalid or unavailable');
  }
  return { id, secret };
}

function tokenHmac(
  purpose: 'context' | 'conversion',
  id: string,
  secret: string,
  key: Uint8Array,
): string {
  return createHmac('sha256', key)
    .update(lengthPrefixed(['boomerbuddy:public-check', purpose, id, secret]))
    .digest('base64url');
}

function minuteBucket(now: Date): string {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
}

function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function incrementAttribution(
  executor: SqlExecutor,
  attribution: PublicCheckAttribution,
  eventKind: 'context_issued' | 'check_completed',
  now: Date,
): Promise<void> {
  await executor.query(
    `INSERT INTO public_check_attribution_aggregates(
       bucket_start, source, campaign, event_kind, event_count
     ) VALUES ($1,$2,$3,$4,1)
     ON CONFLICT (bucket_start, source, campaign, event_kind)
     DO UPDATE SET event_count = public_check_attribution_aggregates.event_count + 1`,
    [dayBucket(now), attribution.source, attribution.campaign, eventKind],
  );
}

async function consumeQuota(
  executor: SqlExecutor,
  scope: 'global_public_context' | 'global_public_check',
  scopeKey: string,
  maximum: number,
  now: Date,
): Promise<void> {
  const quota = await executor.query<Record<string, unknown>>(
    `INSERT INTO public_check_quota_buckets(bucket_start, scope, scope_key, used_count)
     VALUES ($1,$2,$3,1)
     ON CONFLICT (bucket_start, scope, scope_key) DO UPDATE
     SET used_count = public_check_quota_buckets.used_count + 1
     WHERE public_check_quota_buckets.used_count < $4
     RETURNING used_count`,
    [minuteBucket(now), scope, scopeKey, maximum],
  );
  if (quota.rowCount !== 1) {
    throw new DomainError('conflict', 'Public Check capacity is temporarily exhausted');
  }
}

function parsePayload(serialized: string): PublicCheckPayload {
  const parsed: unknown = JSON.parse(serialized);
  if (typeof parsed !== 'object' || parsed === null) throw new TypeError('Invalid public result');
  const value = parsed as Partial<PublicCheckPayload>;
  if (
    (value.kind !== 'text' && value.kind !== 'url') ||
    typeof value.redactedContent !== 'string' ||
    typeof value.decision !== 'object' ||
    value.decision === null ||
    typeof value.inputSafety !== 'object' ||
    value.inputSafety === null
  ) {
    throw new TypeError('Invalid public result');
  }
  return value as PublicCheckPayload;
}

export class PublicCheckRepository {
  constructor(
    private readonly database: Database,
    private readonly protection: PublicCheckProtection,
    private readonly idFactory: IdFactory = randomIdFactory,
    private readonly maximumChecksPerMinute = 30,
    private readonly maximumContextsPerMinute = 60,
    private readonly maximumChecksPerClientMinute = 6,
    private readonly maximumContextsPerClientMinute = 12,
    private readonly maximumConcurrentAnalyses = 20,
    private readonly maximumConcurrentAnalysesPerClient = 2,
  ) {
    assertProtection(protection);
    if (
      !Number.isSafeInteger(maximumChecksPerMinute) ||
      maximumChecksPerMinute < 1 ||
      !Number.isSafeInteger(maximumContextsPerMinute) ||
      maximumContextsPerMinute < 1 ||
      !Number.isSafeInteger(maximumChecksPerClientMinute) ||
      maximumChecksPerClientMinute < 1 ||
      !Number.isSafeInteger(maximumContextsPerClientMinute) ||
      maximumContextsPerClientMinute < 1 ||
      !Number.isSafeInteger(maximumConcurrentAnalyses) ||
      maximumConcurrentAnalyses < 1 ||
      !Number.isSafeInteger(maximumConcurrentAnalysesPerClient) ||
      maximumConcurrentAnalysesPerClient < 1 ||
      maximumConcurrentAnalysesPerClient > maximumConcurrentAnalyses
    ) {
      throw new TypeError('Public Check quotas must be positive safe integers');
    }
  }

  clientKeyForNetworkAddress(networkAddress: string): string {
    const normalized = networkAddress.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 256) {
      throw new DomainError('invalid_input', 'Public Check client address is unavailable');
    }
    return createHmac('sha256', this.protection.hmacKey)
      .update(lengthPrefixed(['boomerbuddy:public-check-client:v1', normalized]))
      .digest('base64url');
  }

  private assertClientKey(clientKey: string): void {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(clientKey)) {
      throw new DomainError('invalid_input', 'Public Check client identity is invalid');
    }
  }

  async createContext(input: {
    readonly attribution: PublicCheckAttribution;
    readonly clientKey: string;
    readonly now: Date;
  }): Promise<PublicCheckContextGrant> {
    this.assertClientKey(input.clientKey);
    const id = this.idFactory.next('public_context');
    const minted = mintToken(id);
    const expiresAt = new Date(input.now.getTime() + 10 * 60_000);
    await this.database.transaction(async (transaction) => {
      await consumeQuota(
        transaction,
        'global_public_context',
        'global',
        this.maximumContextsPerMinute,
        input.now,
      );
      await consumeQuota(
        transaction,
        'global_public_context',
        input.clientKey,
        this.maximumContextsPerClientMinute,
        input.now,
      );
      await transaction.query(
        `INSERT INTO public_check_contexts(
           id, token_hmac, hmac_key_version, attribution_source, attribution_campaign,
           remaining_checks, state, expires_at, created_at, client_key_hmac
         ) VALUES ($1,$2,$3,$4,$5,3,'active',$6,$7,$8)`,
        [
          id,
          tokenHmac('context', id, minted.secret, this.protection.hmacKey),
          this.protection.hmacKeyVersion,
          input.attribution.source,
          input.attribution.campaign,
          expiresAt.toISOString(),
          input.now.toISOString(),
          input.clientKey,
        ],
      );
      await incrementAttribution(transaction, input.attribution, 'context_issued', input.now);
    });
    return { token: minted.token, expiresAt, remainingChecks: 3 };
  }

  async consumeContext(input: {
    readonly token: string;
    readonly clientKey: string;
    readonly now: Date;
  }): Promise<PublicCheckInteraction> {
    this.assertClientKey(input.clientKey);
    const parsed = parseToken(input.token, 'public_context');
    return this.database.transaction(async (transaction) => {
      const selected = await transaction.query<ContextRow>(
        `SELECT id, token_hmac, client_key_hmac, remaining_checks, state, attribution_source,
                attribution_campaign, expires_at
         FROM public_check_contexts WHERE id = $1 FOR UPDATE`,
        [parsed.id],
      );
      const row = selected.rows[0];
      if (
        row === undefined ||
        !constantTimeEqual(
          row.token_hmac,
          tokenHmac('context', parsed.id, parsed.secret, this.protection.hmacKey),
        ) ||
        !constantTimeEqual(row.client_key_hmac, input.clientKey)
      ) {
        throw new DomainError('not_found', 'Public Check grant is invalid or unavailable');
      }
      if (row.state !== 'active' || asDate(row.expires_at, 'public context expiry') <= input.now) {
        await transaction.query(
          `UPDATE public_check_contexts SET state = 'expired'
           WHERE id = $1 AND state = 'active'`,
          [row.id],
        );
        throw new DomainError('expired', 'Public Check context has expired');
      }
      await consumeQuota(
        transaction,
        'global_public_check',
        'global',
        this.maximumChecksPerMinute,
        input.now,
      );
      await consumeQuota(
        transaction,
        'global_public_check',
        input.clientKey,
        this.maximumChecksPerClientMinute,
        input.now,
      );
      const remaining = row.remaining_checks - 1;
      await transaction.query(
        `UPDATE public_check_contexts
         SET remaining_checks = $2, state = CASE WHEN $2 = 0 THEN 'exhausted' ELSE 'active' END
         WHERE id = $1`,
        [row.id, remaining],
      );
      return {
        contextId: row.id,
        source: row.attribution_source,
        campaign: row.attribution_campaign,
      };
    });
  }

  async acquireAnalysisLease(input: {
    readonly clientKey: string;
    readonly now: Date;
    readonly leaseMs?: number;
  }): Promise<string> {
    this.assertClientKey(input.clientKey);
    const leaseMs = input.leaseMs ?? 30_000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 120_000) {
      throw new TypeError('Public Check analysis lease must be between 1 and 120 seconds');
    }
    const leaseId = this.idFactory.next('public_analysis_lease');
    const expiresAt = new Date(input.now.getTime() + leaseMs);
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        'SELECT id FROM public_check_concurrency_gate WHERE id = 1 FOR UPDATE',
      );
      await transaction.query('DELETE FROM public_check_analysis_leases WHERE expires_at <= $1', [
        input.now.toISOString(),
      ]);
      const counts = await transaction.query<
        { global_count: number; client_count: number } & Record<string, unknown>
      >(
        `SELECT count(*)::int AS global_count,
                count(*) FILTER (WHERE client_key_hmac = $1)::int AS client_count
         FROM public_check_analysis_leases`,
        [input.clientKey],
      );
      const count = counts.rows[0];
      if (
        count === undefined ||
        count.global_count >= this.maximumConcurrentAnalyses ||
        count.client_count >= this.maximumConcurrentAnalysesPerClient
      ) {
        throw new DomainError('conflict', 'Public Check analysis capacity is temporarily busy');
      }
      await transaction.query(
        `INSERT INTO public_check_analysis_leases(id, client_key_hmac, expires_at, created_at)
         VALUES ($1,$2,$3,$4)`,
        [leaseId, input.clientKey, expiresAt.toISOString(), input.now.toISOString()],
      );
      return leaseId;
    });
  }

  async releaseAnalysisLease(input: {
    readonly leaseId: string;
    readonly clientKey: string;
  }): Promise<void> {
    this.assertClientKey(input.clientKey);
    await this.database.query(
      `DELETE FROM public_check_analysis_leases
       WHERE id = $1 AND client_key_hmac = $2`,
      [input.leaseId, input.clientKey],
    );
  }

  async recordCompleted(attribution: PublicCheckAttribution, now: Date): Promise<void> {
    await incrementAttribution(this.database, attribution, 'check_completed', now);
  }

  async createResult(
    input: PublicCheckPayload & {
      readonly interaction: PublicCheckInteraction;
      readonly now: Date;
    },
  ): Promise<PublicCheckResultGrant> {
    if (!['unknown', 'caution', 'high_concern'].includes(input.decision.risk)) {
      throw new DomainError('invalid_input', 'Public Check risk uses a reserved value');
    }
    const boundedBytes = input.kind === 'url' ? 4_096 : 16_384;
    const defensivelyMinimized = minimizeRestrictedInput(input.redactedContent, boundedBytes);
    const decisionSafety = minimizeRestrictedInput(JSON.stringify(input.decision), 64 * 1_024);
    if (defensivelyMinimized.status === 'rejected' || decisionSafety.status === 'rejected') {
      throw new DomainError('restricted_input', 'Public Check result contains restricted data');
    }
    const id = this.idFactory.next('public_result');
    const minted = mintToken(id);
    const expiresAt = new Date(input.now.getTime() + 15 * 60_000);
    const payload: PublicCheckPayload = {
      kind: input.kind,
      redactedContent: defensivelyMinimized.minimized,
      decision: input.decision,
      inputSafety: input.inputSafety,
    };
    const encrypted = serializeEncryptedField(
      encryptField(JSON.stringify(payload), this.protection.encryptionKey, {
        tenantId: 'public-anonymous',
        resourceId: id,
        field: 'redacted-result',
        schemaVersion: 1,
        keyVersion: this.protection.encryptionKeyVersion,
      }),
    );
    await this.database.query(
      `INSERT INTO public_check_results(
         id, conversion_hmac, hmac_key_version, encrypted_payload,
         encryption_key_version, state, expires_at, created_at,
         context_id, attribution_source, attribution_campaign
       ) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10)`,
      [
        id,
        tokenHmac('conversion', id, minted.secret, this.protection.hmacKey),
        this.protection.hmacKeyVersion,
        encrypted,
        this.protection.encryptionKeyVersion,
        expiresAt.toISOString(),
        input.now.toISOString(),
        input.interaction.contextId,
        input.interaction.source,
        input.interaction.campaign,
      ],
    );
    return { id, conversionToken: minted.token, expiresAt };
  }

  async saveAsOwnedCheck(input: {
    readonly resultId: string;
    readonly conversionToken: string;
    readonly saveConsent: true;
    readonly consentVersion: 'public-check-save-v1';
    readonly householdId: string;
    readonly actorPersonId: string;
    readonly audience: Audience;
    readonly correlationId: string;
    readonly now: Date;
    readonly authorizeKind: (kind: 'text' | 'url') => void;
    readonly checks: CheckRepository;
  }): Promise<{ readonly check: StoredCheck; readonly created: boolean }> {
    if (
      input.saveConsent !== true ||
      input.consentVersion !== 'public-check-save-v1' ||
      (input.audience !== 'customer' && input.audience !== 'mobile')
    ) {
      throw new DomainError('not_authorized', 'Public Check conversion is not permitted');
    }
    const parsed = parseToken(input.conversionToken, 'public_result');
    if (parsed.id !== input.resultId) {
      throw new DomainError('not_found', 'Public Check grant is invalid or unavailable');
    }
    const expected = tokenHmac('conversion', parsed.id, parsed.secret, this.protection.hmacKey);
    const outcome = await this.database.transaction(async (transaction) => {
      const selected = await transaction.query<ResultRow>(
        `SELECT id, conversion_hmac, encrypted_payload, state, expires_at,
                context_id, attribution_source, attribution_campaign
         FROM public_check_results WHERE id = $1 FOR UPDATE`,
        [input.resultId],
      );
      const row = selected.rows[0];
      const conversionResult = await transaction.query<ConversionRow>(
        `SELECT result_id, actor_person_id, household_id, analysis_id, save_consent,
                consent_version, session_audience, credential_hmac
         FROM public_check_conversions WHERE result_id = $1`,
        [input.resultId],
      );
      const conversion = conversionResult.rows[0];
      if (conversion !== undefined) {
        if (
          (row !== undefined && row.state !== 'consumed') ||
          conversion.actor_person_id !== input.actorPersonId ||
          conversion.household_id !== input.householdId ||
          conversion.save_consent !== input.saveConsent ||
          conversion.consent_version !== input.consentVersion ||
          !constantTimeEqual(conversion.credential_hmac, expected)
        ) {
          throw new DomainError('not_found', 'Public Check grant is invalid or unavailable');
        }
        const existing = await input.checks.findOwnedWithExecutor(transaction, {
          householdId: conversion.household_id,
          checkId: conversion.analysis_id,
          actorPersonId: conversion.actor_person_id,
          now: input.now,
        });
        if (existing === null) {
          throw new DomainError('not_found', 'Saved Check is unavailable');
        }
        input.authorizeKind(existing.kind);
        return { status: 'saved' as const, check: existing, created: false };
      }

      if (row === undefined) {
        throw new DomainError('not_found', 'Public Check grant is invalid or unavailable');
      }

      if (
        row.conversion_hmac === null ||
        !constantTimeEqual(row.conversion_hmac, expected) ||
        row.state !== 'active'
      ) {
        throw new DomainError('not_found', 'Public Check grant is invalid or unavailable');
      }
      if (asDate(row.expires_at, 'public result expiry') <= input.now) {
        await transaction.query(
          `UPDATE public_check_results
           SET state = 'expired', conversion_hmac = NULL, encrypted_payload = NULL
           WHERE id = $1 AND state = 'active'`,
          [row.id],
        );
        return { status: 'expired' as const };
      }
      if (
        row.encrypted_payload === null ||
        row.context_id === null ||
        row.attribution_source === null ||
        row.attribution_campaign === null
      ) {
        throw new DomainError('not_found', 'Public Check grant is invalid or unavailable');
      }
      const decrypted = decryptField(
        parseEncryptedField(row.encrypted_payload),
        this.protection.encryptionKey,
        {
          tenantId: 'public-anonymous',
          resourceId: row.id,
          field: 'redacted-result',
          schemaVersion: 1,
          keyVersion: this.protection.encryptionKeyVersion,
        },
      ).toString('utf8');
      const payload = parsePayload(decrypted);
      input.authorizeKind(payload.kind);
      const check = await input.checks.createWithExecutor(transaction, {
        householdId: input.householdId,
        actorPersonId: input.actorPersonId,
        audience: input.audience,
        kind: payload.kind,
        content: payload.redactedContent,
        decision: payload.decision,
        correlationId: input.correlationId,
        now: input.now,
      });
      await transaction.query(
        `INSERT INTO public_check_conversions(
           result_id, actor_person_id, household_id, context_id,
           attribution_source, attribution_campaign, artifact_id, analysis_id,
           save_consent, consent_version, session_audience, correlation_id,
           credential_hmac, hmac_key_version, converted_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13,$14)`,
        [
          row.id,
          input.actorPersonId,
          input.householdId,
          row.context_id,
          row.attribution_source,
          row.attribution_campaign,
          check.artifactId,
          check.id,
          input.consentVersion,
          input.audience,
          input.correlationId,
          expected,
          this.protection.hmacKeyVersion,
          input.now.toISOString(),
        ],
      );
      await writeAuditAndOutbox(
        transaction,
        this.idFactory,
        {
          householdId: input.householdId,
          actorPersonId: input.actorPersonId,
          audience: input.audience,
          correlationId: input.correlationId,
          now: input.now,
        },
        {
          action: 'public_check.saved',
          resourceType: 'public_check_result',
          resourceId: row.id,
          outcome: 'completed',
          metadata: {
            saveConsent: input.saveConsent,
            consentVersion: input.consentVersion,
            source: row.attribution_source,
            campaign: row.attribution_campaign,
          },
        },
        {
          eventType: 'public_check.saved.v1',
          aggregateType: 'public_check_result',
          aggregateId: row.id,
          payload: {
            saveConsent: input.saveConsent,
            consentVersion: input.consentVersion,
            source: row.attribution_source,
            campaign: row.attribution_campaign,
          },
        },
      );
      const consumed = await transaction.query(
        `UPDATE public_check_results
         SET state = 'consumed', conversion_hmac = NULL, encrypted_payload = NULL, consumed_at = $2
         WHERE id = $1 AND state = 'active'`,
        [row.id, input.now.toISOString()],
      );
      if (consumed.rowCount !== 1) {
        throw new Error('Public Check conversion grant consumption failed');
      }
      return { status: 'saved' as const, check, created: true };
    });
    if (outcome.status === 'expired') {
      throw new DomainError('expired', 'Public Check conversion grant has expired');
    }
    return { check: outcome.check, created: outcome.created };
  }

  async purgeExpired(now: Date): Promise<{ readonly contexts: number; readonly results: number }> {
    return this.database.transaction(async (transaction) => {
      const terminalDeleteBefore = new Date(now.getTime() - anonymousTerminalRetentionMs);
      const contexts = await transaction.query<Record<string, unknown>>(
        `UPDATE public_check_contexts SET state = 'expired'
         WHERE state = 'active' AND expires_at <= $1 RETURNING id`,
        [now.toISOString()],
      );
      const results = await transaction.query<Record<string, unknown>>(
        `UPDATE public_check_results
         SET state = 'expired', conversion_hmac = NULL, encrypted_payload = NULL
         WHERE state = 'active' AND expires_at <= $1 RETURNING id`,
        [now.toISOString()],
      );
      await transaction.query(
        `DELETE FROM public_check_results AS result
         WHERE result.state IN ('consumed', 'expired') AND result.expires_at <= $1`,
        [terminalDeleteBefore.toISOString()],
      );
      await transaction.query(
        `DELETE FROM public_check_contexts AS context
         WHERE context.state IN ('exhausted', 'expired') AND context.expires_at <= $1
           AND NOT EXISTS (
             SELECT 1 FROM public_check_results AS result
             WHERE result.context_id = context.id
           )`,
        [terminalDeleteBefore.toISOString()],
      );
      await transaction.query(`DELETE FROM public_check_quota_buckets WHERE bucket_start < $1`, [
        new Date(now.getTime() - 60 * 60_000).toISOString(),
      ]);
      await transaction.query('DELETE FROM public_check_analysis_leases WHERE expires_at <= $1', [
        now.toISOString(),
      ]);
      await transaction.query(
        `DELETE FROM public_check_attribution_aggregates WHERE bucket_start < $1`,
        [new Date(now.getTime() - 90 * 24 * 60 * 60_000).toISOString().slice(0, 10)],
      );
      return { contexts: contexts.rowCount, results: results.rowCount };
    });
  }
}
