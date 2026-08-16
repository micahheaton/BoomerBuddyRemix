import { createHash } from 'node:crypto';
import type { SqlExecutor } from './database';
import { jsonParameter, type IdFactory } from './values';

export const consentActions = [
  'propose',
  'accept',
  'expand',
  'narrow',
  'withdraw',
  'relinquish',
  'suspend',
  'reactivate',
  'revoke',
  'expire',
  'defer',
] as const;
export type ConsentAction = (typeof consentActions)[number];

export interface ConsentIdentityEvidence {
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly assurance: 'development' | 'verified';
}

export interface ConsentDocuments {
  readonly disclosureVersion: string;
  readonly disclosureDigest: string;
  readonly policyVersion: string;
  readonly policyDigest: string;
}

const disclosureText =
  'BoomerBuddy shares only the exact, redacted result and permissions a protected person chooses. Permission can be narrowed or ended without ending unrelated household authority.';
const policyText =
  'BoomerBuddy Run 2 consent evidence is purpose-limited, pairwise, versioned, auditable, and revocable. Administrator suspension is distinct from participant withdrawal.';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export const run2ConsentDocuments: ConsentDocuments = {
  disclosureVersion: 'family-consent-run2-v1',
  disclosureDigest: digest(disclosureText),
  policyVersion: 'consent-policy-run2-v1',
  policyDigest: digest(policyText),
};

export async function identityEvidenceForPerson(
  executor: SqlExecutor,
  personId: string,
  preferredIssuer?: string,
): Promise<ConsentIdentityEvidence | null> {
  const result = await executor.query<
    { id: string; issuer: string; subject: string } & Record<string, unknown>
  >(
    `SELECT id, issuer, subject FROM identities
     WHERE person_id = $1 AND status = 'active'
       AND ($2::text IS NULL OR issuer = $2)
     ORDER BY created_at, id LIMIT 1`,
    [personId, preferredIssuer ?? null],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        issuer: row.issuer,
        subject: row.subject,
        assurance: row.issuer === 'boomerbuddy-dev' ? 'development' : 'verified',
      };
}

function projectionState(action: ConsentAction) {
  switch (action) {
    case 'propose':
      return 'proposed' as const;
    case 'accept':
    case 'expand':
    case 'narrow':
    case 'reactivate':
      return 'active' as const;
    case 'defer':
      return 'deferred' as const;
    case 'withdraw':
      return 'withdrawn' as const;
    case 'relinquish':
      return 'relinquished' as const;
    case 'suspend':
      return 'suspended' as const;
    case 'revoke':
      return 'revoked' as const;
    case 'expire':
      return 'expired' as const;
  }
}

export async function appendConsentEvidence(
  executor: SqlExecutor,
  idFactory: IdFactory,
  input: {
    readonly householdId: string;
    readonly consentId: string;
    readonly actorPersonId: string;
    readonly subjectPersonId: string;
    readonly recipientPersonId?: string;
    readonly purpose: string;
    readonly scope: Readonly<Record<string, unknown>>;
    readonly action: ConsentAction;
    readonly sourceInteraction: string;
    readonly actorIdentity?: ConsentIdentityEvidence;
    readonly sessionId?: string;
    readonly correlationId?: string;
    readonly effectiveAt: Date;
    readonly expiresAt?: Date;
    readonly documents?: ConsentDocuments;
  },
): Promise<string> {
  const current = await executor.query<{ latest_evidence_id: string } & Record<string, unknown>>(
    `SELECT latest_evidence_id FROM consent_current_projections
     WHERE household_id = $1 AND consent_id = $2 FOR UPDATE`,
    [input.householdId, input.consentId],
  );
  const evidenceId = idFactory.next('consent-evidence');
  const documents = input.documents ?? run2ConsentDocuments;
  const identity = input.actorIdentity;
  await executor.query(
    `INSERT INTO consent_evidence(
       household_id, id, consent_id, actor_person_id, subject_person_id,
       recipient_person_id, purpose, scope, action, disclosure_version,
       disclosure_digest, policy_version, policy_digest, source_interaction,
       session_id, actor_identity_id, actor_identity_issuer, actor_identity_subject,
       assurance, effective_at, expires_at, recorded_at, supersedes_evidence_id,
       correlation_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,
       $15,$16,$17,$18,$19,$20,$21,$20,$22,$23
     )`,
    [
      input.householdId,
      evidenceId,
      input.consentId,
      input.actorPersonId,
      input.subjectPersonId,
      input.recipientPersonId ?? null,
      input.purpose,
      jsonParameter(input.scope),
      input.action,
      documents.disclosureVersion,
      documents.disclosureDigest,
      documents.policyVersion,
      documents.policyDigest,
      input.sourceInteraction,
      input.sessionId ?? null,
      identity?.id ?? null,
      identity?.issuer ?? null,
      identity?.subject ?? null,
      identity?.assurance ?? 'legacy_unverified',
      input.effectiveAt.toISOString(),
      input.expiresAt?.toISOString() ?? null,
      current.rows[0]?.latest_evidence_id ?? null,
      input.correlationId ?? null,
    ],
  );
  await executor.query(
    `INSERT INTO consent_current_projections(
       household_id, consent_id, latest_evidence_id, actor_person_id,
       subject_person_id, recipient_person_id, purpose, scope, state,
       effective_at, expires_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$10)
     ON CONFLICT (household_id, consent_id) DO UPDATE SET
       latest_evidence_id = EXCLUDED.latest_evidence_id,
       actor_person_id = EXCLUDED.actor_person_id,
       subject_person_id = EXCLUDED.subject_person_id,
       recipient_person_id = EXCLUDED.recipient_person_id,
       purpose = EXCLUDED.purpose,
       scope = EXCLUDED.scope,
       state = EXCLUDED.state,
       effective_at = EXCLUDED.effective_at,
       expires_at = EXCLUDED.expires_at,
       updated_at = EXCLUDED.updated_at`,
    [
      input.householdId,
      input.consentId,
      evidenceId,
      input.actorPersonId,
      input.subjectPersonId,
      input.recipientPersonId ?? null,
      input.purpose,
      jsonParameter(input.scope),
      projectionState(input.action),
      input.effectiveAt.toISOString(),
      input.expiresAt?.toISOString() ?? null,
    ],
  );
  return evidenceId;
}
