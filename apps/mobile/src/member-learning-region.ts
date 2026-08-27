import {
  memberLearningCoarseRegionCodes,
  type MemberLearningPreferencesDto,
} from '@boomerbuddy/contracts';

type CoarseRegion = MemberLearningPreferencesDto['coarseRegion'];

export const supportedMemberLearningStateCodes = memberLearningCoarseRegionCodes
  .filter((region) => region !== 'US')
  .map((region) => region.slice(3));

const supportedCoarseRegions = new Set<string>(memberLearningCoarseRegionCodes);

export function resolveMemberLearningCoarseRegion(value: string): CoarseRegion | undefined {
  const normalized = value.trim().toUpperCase();
  const candidate = normalized ? `US-${normalized}` : 'US';
  return supportedCoarseRegions.has(candidate) ? (candidate as CoarseRegion) : undefined;
}
