import { describe, expect, it } from 'vitest';
import {
  resolveMemberLearningCoarseRegion,
  supportedMemberLearningStateCodes,
} from './member-learning-region';

describe('mobile member-learning region selection', () => {
  it('matches the supported 50 states plus District of Columbia set', () => {
    expect(supportedMemberLearningStateCodes).toHaveLength(51);
    expect(new Set(supportedMemberLearningStateCodes).size).toBe(51);
    expect(supportedMemberLearningStateCodes).toContain('CA');
    expect(supportedMemberLearningStateCodes).toContain('DC');
  });

  it('normalizes supported input and rejects invented two-letter codes', () => {
    expect(resolveMemberLearningCoarseRegion('')).toBe('US');
    expect(resolveMemberLearningCoarseRegion(' ca ')).toBe('US-CA');
    expect(resolveMemberLearningCoarseRegion('dc')).toBe('US-DC');
    expect(resolveMemberLearningCoarseRegion('ZZ')).toBeUndefined();
    expect(resolveMemberLearningCoarseRegion('California')).toBeUndefined();
  });
});
