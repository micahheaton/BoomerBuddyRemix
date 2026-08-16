import { describe, expect, it } from 'vitest';
import {
  DomainError,
  completeOrientationStep,
  createOrientation,
  hasCapability,
  ids,
  isGrantEffective,
  recordSafeWordDisposition,
  resolveEffectiveEntitlements,
  startOrientation,
} from './index';

describe('opaque identifiers', () => {
  it('brands bounded opaque values and rejects unsafe values', () => {
    expect(ids.person('person_001')).toBe('person_001');
    expect(() => ids.person('x')).toThrow(TypeError);
    expect(() => ids.person('spaces are unsafe')).toThrow(TypeError);
  });
});

describe('canonical entitlements', () => {
  const now = new Date('2026-01-02T00:00:00Z');
  const base = {
    subject: { kind: 'household' as const, householdId: ids.household('household_001') },
    source: 'local' as const,
    startsAt: new Date('2026-01-01T00:00:00Z'),
    sourceVerified: true,
    precedence: 1,
  };

  it('combines only verified, active, non-revoked grants', () => {
    const active = {
      ...base,
      id: ids.entitlementGrant('grant_active'),
      capabilities: ['check:text' as const],
    };
    const unverified = {
      ...base,
      id: ids.entitlementGrant('grant_unverified'),
      capabilities: ['family:manage' as const],
      sourceVerified: false,
    };
    const result = resolveEffectiveEntitlements([unverified, active], now);
    expect(result.contributingGrantIds).toEqual([active.id]);
    expect(hasCapability(result, 'check:text')).toBe(true);
    expect(hasCapability(result, 'family:manage')).toBe(false);
    expect(hasCapability(['check:url'], 'check:url')).toBe(true);
  });

  it('honors expiry and revocation boundaries', () => {
    expect(
      isGrantEffective(
        {
          ...base,
          id: ids.entitlementGrant('grant_expired'),
          capabilities: [],
          endsAt: now,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isGrantEffective(
        {
          ...base,
          id: ids.entitlementGrant('grant_revoked'),
          capabilities: [],
          revokedAt: now,
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('orientation workflow', () => {
  it('requires ordered, informed completion and reaches ready', () => {
    let state = startOrientation(createOrientation());
    state = completeOrientationStep(state, 'protection_subject');
    state = completeOrientationStep(state, 'trusted_circle');
    expect(() => completeOrientationStep(state, 'safe_word')).toThrow(DomainError);
    state = recordSafeWordDisposition(state, 'informed_deferral');
    for (const step of [
      'safe_word',
      'practice_check',
      'capabilities_and_limits',
      'review',
    ] as const) {
      state = completeOrientationStep(state, step);
    }
    expect(state.status).toBe('ready');
    expect(completeOrientationStep(state, 'review')).toBe(state);
  });

  it('rejects out-of-order and post-completion safe-word mutations', () => {
    let state = startOrientation(createOrientation());
    expect(() => completeOrientationStep(state, 'trusted_circle')).toThrow(DomainError);
    state = completeOrientationStep(state, 'protection_subject');
    state = completeOrientationStep(state, 'trusted_circle');
    state = recordSafeWordDisposition(state, 'configured');
    state = completeOrientationStep(state, 'safe_word');
    expect(() => recordSafeWordDisposition(state, 'informed_deferral')).toThrow(DomainError);
  });
});
