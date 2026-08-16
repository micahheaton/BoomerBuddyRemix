import type { CheckResult } from '@boomerbuddy/contracts';

export type RootStackParamList = {
  SignIn: undefined;
  Home: undefined;
  Check: undefined;
  Result: { check: CheckResult };
  History: undefined;
  Family: undefined;
  Orientation: undefined;
};
