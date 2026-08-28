import type { CheckResult } from '@boomerbuddy/contracts';

export type NativeEntrySignal = 'none' | 'route_only_check' | 'rejected_payload';

function hasRejectedNativeEntryCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      character === '\\'
    ) {
      return true;
    }
  }
  return false;
}

export function classifyNativeEntryUrl(url: string): NativeEntrySignal {
  const checkPrefix = 'boomerbuddy://check';
  const targetsCheck = url.slice(0, checkPrefix.length).toLowerCase() === checkPrefix;
  if (url.length > 2_048 || hasRejectedNativeEntryCharacter(url)) {
    return targetsCheck ? 'rejected_payload' : 'none';
  }
  const normalized = url.toLowerCase();
  if (normalized === 'boomerbuddy://check' || normalized === 'boomerbuddy://check/') {
    return 'route_only_check';
  }
  return targetsCheck ? 'rejected_payload' : 'none';
}

export type RootStackParamList = {
  SignIn: undefined;
  SessionRecovery: undefined;
  Home: undefined;
  Check: undefined;
  Result: { check: CheckResult };
  History: undefined;
  Family: undefined;
  FamilySafeWord: undefined;
  ProtectedAccess: undefined;
  Orientation: undefined;
  LearnUpdates: undefined;
  Feedback: undefined;
  HelpPolicies: undefined;
  Support: undefined;
  Privacy: undefined;
  Terms: undefined;
  Accessibility: undefined;
  AccountDeletion: undefined;
  NativeProof: undefined;
};
