export type MobileHostedAuthResult = {
  readonly createdSessionId: string | null;
  readonly authSessionResult?: { readonly type?: string } | null;
};

export type MobileHostedAuthPlatform = 'ios' | 'android';

const mobileHostedAuthRedirectUrls: Record<MobileHostedAuthPlatform, string> = {
  ios: 'net.boomerbuddy.app://callback',
  android: 'clerk://net.boomerbuddy.app.hosted-callback',
};

export type StartMobileHostedAuth = (input: {
  readonly mode: 'sign-in';
  readonly redirectUrl: string;
}) => Promise<MobileHostedAuthResult>;

export type MobileHostedSignInOutcome = 'session_created' | 'not_completed';

export function mobileHostedAuthRedirectUrl(platform: MobileHostedAuthPlatform): string {
  return mobileHostedAuthRedirectUrls[platform];
}

function hasUnsafeCallbackCharacter(value: string): boolean {
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

export function isMobileHostedAuthCallbackUrl(value: string): boolean {
  if (value.length > 2_048 || hasUnsafeCallbackCharacter(value)) return false;
  let actual: URL;
  try {
    actual = new URL(value);
  } catch {
    return false;
  }
  return Object.values(mobileHostedAuthRedirectUrls).some((expectedValue) => {
    const expected = new URL(expectedValue);
    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname &&
      actual.username === '' &&
      actual.password === '' &&
      actual.port === ''
    );
  });
}

export async function startMobileHostedSignIn(
  startHostedAuth: StartMobileHostedAuth,
  platform: MobileHostedAuthPlatform,
): Promise<MobileHostedSignInOutcome> {
  const result = await startHostedAuth({
    mode: 'sign-in',
    redirectUrl: mobileHostedAuthRedirectUrl(platform),
  });
  return result.createdSessionId ? 'session_created' : 'not_completed';
}
