import type { CheckResult } from '@boomerbuddy/contracts';

export type NativeEntrySignal = 'none' | 'route_only_check' | 'rejected_payload';

export type RootStackParamList = {
  SignIn: undefined;
  Home: undefined;
  Check: undefined;
  Result: { check: CheckResult };
  History: undefined;
  Family: undefined;
  Orientation: undefined;
  NativeProof: undefined;
};
