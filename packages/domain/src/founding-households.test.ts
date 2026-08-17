import { describe, expect, it } from 'vitest';

import {
  assertActiveFoundingHouseholdPolicy,
  effectiveFoundingHouseholdEnrollmentState,
  effectiveFoundingHouseholdInvitationState,
  foundingHouseholdAccessEndsAt,
  foundingHouseholdBenefitProfiles,
  foundingHouseholdInvitationEndsAt,
} from './founding-households';

const now = new Date('2026-08-16T12:00:00.000Z');

describe('Founding Household domain policy', () => {
  it('pins two finite code-owned sponsored benefit profiles', () => {
    expect(foundingHouseholdBenefitProfiles.plus_beta_v1).toMatchObject({
      planVersionId: 'founding_plus_beta_v2',
      protectedMemberLimit: 1,
      trustedCircleLimit: 2,
    });
    expect(foundingHouseholdBenefitProfiles.family_beta_v1).toMatchObject({
      planVersionId: 'founding_family_beta_v2',
      protectedMemberLimit: 3,
      trustedCircleLimit: 6,
    });
  });

  it('accepts only a bounded, explicitly expiring active policy', () => {
    expect(() =>
      assertActiveFoundingHouseholdPolicy(
        {
          benefitKey: 'plus_beta_v1',
          maxHouseholds: 5,
          invitationTtlDays: 7,
          accessDurationDays: 45,
          programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        now,
      ),
    ).not.toThrow();
    for (const invalid of [0, 26, 1.5]) {
      expect(() =>
        assertActiveFoundingHouseholdPolicy(
          {
            benefitKey: 'plus_beta_v1',
            maxHouseholds: invalid,
            invitationTtlDays: 7,
            accessDurationDays: 45,
            programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
          },
          now,
        ),
      ).toThrow();
    }
    expect(() =>
      assertActiveFoundingHouseholdPolicy(
        {
          benefitKey: 'family_beta_v1',
          maxHouseholds: 5,
          invitationTtlDays: 15,
          accessDurationDays: 45,
          programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      assertActiveFoundingHouseholdPolicy(
        {
          benefitKey: 'family_beta_v1',
          maxHouseholds: 5,
          invitationTtlDays: 7,
          accessDurationDays: 181,
          programEndsAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      assertActiveFoundingHouseholdPolicy(
        {
          benefitKey: 'family_beta_v1',
          maxHouseholds: 5,
          invitationTtlDays: 7,
          accessDurationDays: 45,
          programEndsAt: new Date('2027-08-16T12:00:00.000Z'),
        },
        now,
      ),
    ).toThrow();
  });

  it('caps invitation and access ends at the immutable policy end', () => {
    const programEndsAt = new Date('2026-08-20T12:00:00.000Z');
    expect(foundingHouseholdInvitationEndsAt(now, 7, programEndsAt)).toEqual(programEndsAt);
    expect(foundingHouseholdAccessEndsAt(now, 30, programEndsAt)).toEqual(programEndsAt);
  });

  it('derives natural expiry without pretending a terminal mutation occurred', () => {
    const end = new Date('2026-08-16T11:59:59.000Z');
    expect(effectiveFoundingHouseholdInvitationState('pending', end, now)).toBe('expired');
    expect(effectiveFoundingHouseholdEnrollmentState('active', end, now)).toBe('expired');
    expect(effectiveFoundingHouseholdInvitationState('revoked', end, now)).toBe('revoked');
  });
});
