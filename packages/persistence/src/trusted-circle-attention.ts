import type { Database } from './database';
import { asDate } from './values';

const trustedCircleAttentionPageSize = 20;

export interface PendingTrustedCircleAcknowledgementRecord {
  readonly checkId: string;
  readonly sharedAt: Date;
}

export interface TrustedCircleAttentionRecord {
  readonly pendingAcknowledgementCount: number;
  readonly pendingAcknowledgements: readonly PendingTrustedCircleAcknowledgementRecord[];
  readonly hasMore: boolean;
}

interface TrustedCircleAttentionRow extends Record<string, unknown> {
  readonly pending_count: unknown;
  readonly analysis_id: string | null;
  readonly created_at: unknown | null;
}

function pendingCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError('Invalid Trusted Circle attention count');
  }
  return parsed;
}

export class TrustedCircleAttentionRepository {
  constructor(private readonly database: Database) {}

  async pendingAcknowledgements(input: {
    readonly householdId: string;
    readonly recipientPersonId: string;
    readonly now: Date;
  }): Promise<TrustedCircleAttentionRecord> {
    const result = await this.database.query<TrustedCircleAttentionRow>(
      `WITH eligible AS (
         SELECT share.analysis_id, share.created_at
         FROM check_shares share
         JOIN analyses analysis
           ON analysis.household_id = share.household_id
          AND analysis.id = share.analysis_id
         JOIN artifacts artifact
           ON artifact.household_id = analysis.household_id
          AND artifact.id = analysis.artifact_id
         JOIN trusted_circle_relationships relationship
           ON relationship.household_id = share.household_id
          AND relationship.id = share.relationship_id
         JOIN household_memberships trusted_membership
           ON trusted_membership.household_id = relationship.household_id
          AND trusted_membership.person_id = relationship.trusted_person_id
          AND trusted_membership.status = 'active'
         JOIN household_memberships protected_membership
           ON protected_membership.household_id = relationship.household_id
          AND protected_membership.person_id = relationship.protected_person_id
          AND protected_membership.status = 'active'
         JOIN consents consent
           ON consent.household_id = relationship.household_id
          AND consent.id = relationship.consent_id
          AND consent.state = 'active'
         WHERE share.household_id = $1
           AND share.shared_with_person_id = $2
           AND share.shared_by_person_id = relationship.protected_person_id
           AND share.lifecycle_state = 'shared'
           AND relationship.trusted_person_id = $2
           AND relationship.protected_person_id = analysis.requested_by
           AND relationship.state = 'active'
           AND relationship.permissions ? 'view_shared_checks'
           AND analysis.state = 'completed'
           AND artifact.state = 'active'
           AND artifact.delete_after > $3
       ), limited AS (
         SELECT analysis_id, created_at
         FROM eligible
         ORDER BY created_at, analysis_id
         LIMIT $4
       )
       SELECT total.pending_count, limited.analysis_id, limited.created_at
       FROM (SELECT count(*)::integer AS pending_count FROM eligible) total
       LEFT JOIN limited ON true
       ORDER BY limited.created_at NULLS LAST, limited.analysis_id NULLS LAST`,
      [
        input.householdId,
        input.recipientPersonId,
        input.now.toISOString(),
        trustedCircleAttentionPageSize,
      ],
    );
    const first = result.rows[0];
    if (first === undefined) throw new Error('Trusted Circle attention count was not returned');
    const count = pendingCount(first.pending_count);
    const acknowledgements = result.rows.flatMap((row) =>
      row.analysis_id === null || row.created_at === null
        ? []
        : [
            {
              checkId: row.analysis_id,
              sharedAt: asDate(row.created_at, 'check_shares.created_at'),
            },
          ],
    );
    return {
      pendingAcknowledgementCount: count,
      pendingAcknowledgements: acknowledgements,
      hasMore: count > acknowledgements.length,
    };
  }
}
