import { describe, expect, it } from 'vitest';

import {
  assertFounderProvisioningEvidenceChronology,
  assertFounderProvisioningTransition,
  founderProvisioningCatalogue,
  founderProvisioningEntry,
  founderProvisioningEvidenceClockSkewMs,
  founderProvisioningProofFreshnessMs,
  founderProvisioningStatuses,
  founderProvisioningWorkstreamKeys,
  type FounderProvisioningStatus,
  type FounderProvisioningTransitionEvidence,
} from './founder-provisioning';

const retainedDigest = 'A'.repeat(43);

describe('founder provisioning catalogue', () => {
  it('owns one versioned definition for each of the exact 23 workstreams', () => {
    expect(founderProvisioningCatalogue).toHaveLength(23);
    expect(founderProvisioningWorkstreamKeys).toHaveLength(23);
    expect(founderProvisioningCatalogue.map(({ key }) => key)).toEqual(
      founderProvisioningWorkstreamKeys,
    );
    expect(new Set(founderProvisioningCatalogue.map(({ key }) => key)).size).toBe(23);
    expect(
      founderProvisioningCatalogue.every(({ definitionVersion }) => definitionVersion === 1),
    ).toBe(true);
  });

  it('preserves the reconciled Run 3 baseline without promoting reported setup', () => {
    const counts = Object.fromEntries(founderProvisioningStatuses.map((status) => [status, 0]));
    for (const entry of founderProvisioningCatalogue) {
      counts[entry.initialStatus] = (counts[entry.initialStatus] ?? 0) + 1;
    }

    expect(counts).toEqual({
      not_started: 11,
      founder_in_progress: 7,
      ready_for_test: 0,
      test_proven: 0,
      ready_for_live_review: 0,
      blocked: 5,
    });
  });

  it('contains only unique bounded codes and environment-variable names', () => {
    const displayOrders = founderProvisioningCatalogue.map(({ displayOrder }) => displayOrder);
    expect(new Set(displayOrders).size).toBe(23);
    expect(displayOrders).toEqual([...displayOrders].sort((left, right) => left - right));

    for (const entry of founderProvisioningCatalogue) {
      expect(entry.manualSteps.length, entry.key).toBeGreaterThan(0);
      expect(entry.requiredIdentifierNames.length, entry.key).toBeGreaterThan(0);
      expect(entry.allowedProofTiers.length, entry.key).toBeGreaterThan(0);
      expect(new Set(entry.allowedProofTiers).size, entry.key).toBe(entry.allowedProofTiers.length);
      const stepCodes = entry.manualSteps.map(({ code }) => code);
      expect(new Set(stepCodes).size, entry.key).toBe(stepCodes.length);
      for (const code of stepCodes) expect(code, entry.key).toMatch(/^[a-z][a-z0-9_]{2,63}$/);

      const environmentNames = [
        ...entry.configurationEnvironmentNames,
        ...entry.secretEnvironmentNames,
      ];
      expect(new Set(environmentNames).size, entry.key).toBe(environmentNames.length);
      for (const name of environmentNames)
        expect(name, entry.key).toMatch(/^[A-Z][A-Z0-9_]{1,79}$/);
    }
  });

  it('does not invent provider environment names for adapters that are not implemented', () => {
    for (const entry of founderProvisioningCatalogue) {
      if (entry.adapterState !== 'not_implemented') continue;
      expect(entry.configurationEnvironmentNames, entry.key).toEqual([]);
      expect(entry.secretEnvironmentNames, entry.key).toEqual([]);
    }
  });

  it('contains no credential, URL, connection string, private key, or token-shaped value', () => {
    const serialized = JSON.stringify(founderProvisioningCatalogue);
    expect(serialized).not.toMatch(/(?:sk|pk)_(?:test|live)_[A-Za-z0-9]+/);
    expect(serialized).not.toMatch(/whsec_[A-Za-z0-9]+/);
    expect(serialized).not.toMatch(/postgres(?:ql)?:\/\//);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toContain('-----BEGIN');
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  });
});

describe('founder provisioning status transitions', () => {
  const stripe = founderProvisioningEntry('stripe');

  it('enforces the complete six-status transition graph', () => {
    const upward = [
      'not_started',
      'founder_in_progress',
      'ready_for_test',
      'test_proven',
      'ready_for_live_review',
    ] as const;
    const evidenceFor = (
      from: FounderProvisioningStatus,
      to: FounderProvisioningStatus,
    ): FounderProvisioningTransitionEvidence => {
      if (to === 'blocked') {
        return {
          tier: 'founder_report',
          kind: 'blocker_recorded',
          result: 'blocked',
          blockerCode: 'technical_failure',
        };
      }
      if (from === 'blocked') {
        return to === 'not_started'
          ? { tier: 'founder_report', kind: 'account_removed', result: 'invalidated' }
          : { tier: 'founder_report', kind: 'blocker_cleared', result: 'reported' };
      }
      if (upward.indexOf(to) < upward.indexOf(from)) {
        return { tier: 'provider_test', kind: 'evidence_invalidated', result: 'invalidated' };
      }
      if (to === 'founder_in_progress') {
        return { tier: 'founder_report', kind: 'setup_started', result: 'reported' };
      }
      if (to === 'ready_for_test') {
        return {
          tier: 'repository_review',
          kind: 'configuration_ready',
          result: 'passed',
          manifestDigest: retainedDigest,
        };
      }
      if (to === 'test_proven') {
        return {
          tier: 'provider_test',
          kind: 'verification_passed',
          result: 'passed',
          manifestDigest: retainedDigest,
        };
      }
      return {
        tier: 'deployed_staging',
        kind: 'live_review_packet_complete',
        result: 'passed',
        manifestDigest: retainedDigest,
      };
    };

    for (const from of founderProvisioningStatuses) {
      for (const to of founderProvisioningStatuses) {
        const fromIndex = upward.indexOf(from as (typeof upward)[number]);
        const toIndex = upward.indexOf(to as (typeof upward)[number]);
        const expectedAllowed =
          from !== to &&
          (to === 'blocked' ||
            (from === 'blocked' && (to === 'not_started' || to === 'founder_in_progress')) ||
            (from !== 'blocked' && (toIndex < fromIndex || toIndex === fromIndex + 1)));

        let allowed = true;
        try {
          assertFounderProvisioningTransition({
            workstream: stripe,
            from,
            to,
            evidence: evidenceFor(from, to),
          });
        } catch {
          allowed = false;
        }
        expect(allowed, `${from} -> ${to}`).toBe(expectedAllowed);
      }
    }
  });

  it('requires every upward evidence gate and refuses a skip', () => {
    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'not_started',
        to: 'ready_for_test',
        evidence: { tier: 'founder_report', kind: 'configuration_ready', result: 'passed' },
      }),
    ).toThrow('cannot skip');

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'not_started',
        to: 'founder_in_progress',
        evidence: { tier: 'founder_report', kind: 'setup_started', result: 'reported' },
      }),
    ).not.toThrow();

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'founder_in_progress',
        to: 'ready_for_test',
        evidence: {
          tier: 'repository_review',
          kind: 'configuration_ready',
          result: 'passed',
          manifestDigest: retainedDigest,
        },
      }),
    ).not.toThrow();
  });

  it('requires retained allowed external proof before test_proven', () => {
    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'ready_for_test',
        to: 'test_proven',
        evidence: {
          tier: 'local_simulation',
          kind: 'verification_passed',
          result: 'passed',
          manifestDigest: retainedDigest,
        },
      }),
    ).toThrow('allowed external evidence tier');

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'ready_for_test',
        to: 'test_proven',
        evidence: {
          tier: 'provider_test',
          kind: 'verification_passed',
          result: 'passed',
          manifestDigest: retainedDigest,
        },
      }),
    ).not.toThrow();
  });

  it('requires a staging, human, or professional packet before live review', () => {
    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'test_proven',
        to: 'ready_for_live_review',
        evidence: {
          tier: 'provider_test',
          kind: 'live_review_packet_complete',
          result: 'passed',
          manifestDigest: retainedDigest,
        },
      }),
    ).toThrow('Live review requires');

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'test_proven',
        to: 'ready_for_live_review',
        evidence: {
          tier: 'deployed_staging',
          kind: 'live_review_packet_complete',
          result: 'passed',
          manifestDigest: retainedDigest,
        },
      }),
    ).not.toThrow();
  });

  it('requires structured blockers and a bounded recovery path', () => {
    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'founder_in_progress',
        to: 'blocked',
        evidence: { tier: 'founder_report', kind: 'blocker_recorded', result: 'blocked' },
      }),
    ).toThrow('structured blocker');

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'founder_in_progress',
        to: 'blocked',
        evidence: {
          tier: 'founder_report',
          kind: 'blocker_recorded',
          result: 'blocked',
          blockerCode: 'founder_credential_required',
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'blocked',
        to: 'ready_for_test',
        evidence: { tier: 'founder_report', kind: 'blocker_cleared', result: 'reported' },
      }),
    ).toThrow('must return through founder progress');

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'blocked',
        to: 'founder_in_progress',
        evidence: { tier: 'founder_report', kind: 'blocker_cleared', result: 'reported' },
      }),
    ).not.toThrow();
  });

  it('requires invalidation evidence for downgrades and refuses no-ops', () => {
    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'test_proven',
        to: 'ready_for_test',
        evidence: { tier: 'founder_report', kind: 'setup_started', result: 'reported' },
      }),
    ).toThrow('requires invalidation');

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'test_proven',
        to: 'ready_for_test',
        evidence: {
          tier: 'provider_test',
          kind: 'evidence_invalidated',
          result: 'invalidated',
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertFounderProvisioningTransition({
        workstream: stripe,
        from: 'ready_for_test',
        to: 'ready_for_test',
        evidence: { tier: 'founder_report', kind: 'configuration_ready', result: 'passed' },
      }),
    ).toThrow('cannot be no-ops');
  });
});

describe('founder provisioning evidence chronology', () => {
  const recordedAt = new Date('2026-08-16T20:00:00.000Z');

  it('accepts current post-gate evidence and the exact proof freshness boundary', () => {
    expect(() =>
      assertFounderProvisioningEvidenceChronology({
        currentStatusOccurredAt: new Date(recordedAt.getTime() - 48 * 60 * 60 * 1_000),
        evidenceObservedAt: new Date(recordedAt.getTime() - founderProvisioningProofFreshnessMs),
        recordedAt,
        toStatus: 'test_proven',
      }),
    ).not.toThrow();
  });

  it('rejects ancient or pre-gate evidence for every nonbaseline transition', () => {
    const currentStatusOccurredAt = new Date(recordedAt.getTime() - 60_000);
    expect(() =>
      assertFounderProvisioningEvidenceChronology({
        currentStatusOccurredAt,
        evidenceObservedAt: new Date(currentStatusOccurredAt.getTime() - 1),
        recordedAt,
        toStatus: 'founder_in_progress',
      }),
    ).toThrow('predates the current status gate');
  });

  it.each(['test_proven', 'ready_for_live_review'] as const)(
    'rejects %s evidence older than the 24-hour database-time bound',
    (toStatus) => {
      expect(() =>
        assertFounderProvisioningEvidenceChronology({
          currentStatusOccurredAt: new Date(recordedAt.getTime() - 48 * 60 * 60 * 1_000),
          evidenceObservedAt: new Date(
            recordedAt.getTime() - founderProvisioningProofFreshnessMs - 1,
          ),
          recordedAt,
          toStatus,
        }),
      ).toThrow('older than the 24-hour freshness bound');
    },
  );

  it('rejects observations beyond bounded clock skew and incoherent database chronology', () => {
    expect(() =>
      assertFounderProvisioningEvidenceChronology({
        currentStatusOccurredAt: recordedAt,
        evidenceObservedAt: new Date(
          recordedAt.getTime() + founderProvisioningEvidenceClockSkewMs + 1,
        ),
        recordedAt,
        toStatus: 'founder_in_progress',
      }),
    ).toThrow('future-dated');
    expect(() =>
      assertFounderProvisioningEvidenceChronology({
        currentStatusOccurredAt: new Date(recordedAt.getTime() + 1),
        evidenceObservedAt: recordedAt,
        recordedAt,
        toStatus: 'founder_in_progress',
      }),
    ).toThrow('later than database recording time');
  });
});
