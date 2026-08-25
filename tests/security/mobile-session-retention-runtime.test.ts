import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runMobileSessionRetentionSweep } from '../../apps/worker/src/mobile-session-retention';

const now = new Date('2026-08-25T12:00:00.000Z');
const cutoff = new Date('2026-08-24T12:00:00.000Z');

describe('mobile session retention runtime', () => {
  it('monitors, cleans one bounded batch, and logs aggregate fields only', async () => {
    const monitor = vi.fn(async () => ({
      observedAt: now,
      cleanupEligibleBefore: cutoff,
      totalSessionCount: 40,
      expiredSessionCount: 30,
      retainedInGraceCount: 4,
      cleanupEligibleCount: 20,
      evidenceProtectedCount: 5,
      consentEvidenceProtectedCount: 3,
      foundingHouseholdEvidenceProtectedCount: 2,
      revocationProtectedCount: 1,
    }));
    const cleanup = vi.fn(async () => ({
      observedAt: now,
      cleanupEligibleBefore: cutoff,
      requestedLimit: 100,
      deletedCount: 20,
      remainingEligibleCount: 0,
    }));
    const info = vi.fn();

    await expect(
      runMobileSessionRetentionSweep({
        retention: { monitor, cleanup },
        logger: { info },
        now,
        limit: 100,
      }),
    ).resolves.toMatchObject({ cleanupSaturated: false });
    expect(monitor).toHaveBeenCalledWith(now);
    expect(cleanup).toHaveBeenCalledWith({ now, limit: 100 });
    expect(info).toHaveBeenCalledWith('mobile_session_retention.sweep_completed', {
      totalMobileSessionCount: 40,
      expiredMobileSessionCount: 30,
      retainedInGraceCount: 4,
      cleanupEligibleCount: 20,
      evidenceProtectedCount: 5,
      consentEvidenceProtectedCount: 3,
      foundingHouseholdEvidenceProtectedCount: 2,
      revocationProtectedCount: 1,
      deletedCount: 20,
      remainingEligibleCount: 0,
    });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(
      /providerSession|identityId|subject|personId/u,
    );
  });

  it('marks a full batch for an immediate follow-up schedule', async () => {
    const result = await runMobileSessionRetentionSweep({
      retention: {
        monitor: async () => ({
          observedAt: now,
          cleanupEligibleBefore: cutoff,
          totalSessionCount: 500,
          expiredSessionCount: 500,
          retainedInGraceCount: 0,
          cleanupEligibleCount: 500,
          evidenceProtectedCount: 0,
          consentEvidenceProtectedCount: 0,
          foundingHouseholdEvidenceProtectedCount: 0,
          revocationProtectedCount: 0,
        }),
        cleanup: async () => ({
          observedAt: now,
          cleanupEligibleBefore: cutoff,
          requestedLimit: 100,
          deletedCount: 100,
          remainingEligibleCount: 400,
        }),
      },
      logger: { info: () => undefined },
      now,
      limit: 100,
    });
    expect(result.cleanupSaturated).toBe(true);
  });

  it('composes the repository into the already scheduled worker retention sweep', () => {
    const server = readFileSync(
      resolve(import.meta.dirname, '../../apps/worker/src/server.ts'),
      'utf8',
    );
    expect(server).toContain('new MobileJtiSessionRetentionRepository(database)');
    expect(server).toContain('runMobileSessionRetentionSweep({');
    expect(server).toContain("type: 'retention.sweep'");
    expect(server).toContain('mobileRetention.cleanupSaturated');
  });
});
