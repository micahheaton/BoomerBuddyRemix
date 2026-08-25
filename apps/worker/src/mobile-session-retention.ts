import type { Logger } from '@boomerbuddy/observability';
import type {
  MobileJtiSessionCleanupResult,
  MobileJtiSessionRetentionRepository,
  MobileJtiSessionRetentionSnapshot,
} from '@boomerbuddy/persistence';

export interface MobileSessionRetentionSweepResult {
  readonly snapshot: MobileJtiSessionRetentionSnapshot;
  readonly cleanup: MobileJtiSessionCleanupResult;
  readonly cleanupSaturated: boolean;
}

export async function runMobileSessionRetentionSweep(input: {
  readonly retention: Pick<MobileJtiSessionRetentionRepository, 'monitor' | 'cleanup'>;
  readonly logger: Pick<Logger, 'info'>;
  readonly now: Date;
  readonly limit: number;
}): Promise<MobileSessionRetentionSweepResult> {
  const snapshot = await input.retention.monitor(input.now);
  const cleanup = await input.retention.cleanup({ now: input.now, limit: input.limit });
  input.logger.info('mobile_session_retention.sweep_completed', {
    totalMobileSessionCount: snapshot.totalSessionCount,
    expiredMobileSessionCount: snapshot.expiredSessionCount,
    retainedInGraceCount: snapshot.retainedInGraceCount,
    cleanupEligibleCount: snapshot.cleanupEligibleCount,
    evidenceProtectedCount: snapshot.evidenceProtectedCount,
    consentEvidenceProtectedCount: snapshot.consentEvidenceProtectedCount,
    foundingHouseholdEvidenceProtectedCount: snapshot.foundingHouseholdEvidenceProtectedCount,
    revocationProtectedCount: snapshot.revocationProtectedCount,
    deletedCount: cleanup.deletedCount,
    remainingEligibleCount: cleanup.remainingEligibleCount,
  });
  return {
    snapshot,
    cleanup,
    cleanupSaturated: cleanup.deletedCount === input.limit,
  };
}
