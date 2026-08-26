export type MobileHostedAuthResult = {
  readonly createdSessionId: string | null;
  readonly authSessionResult?: { readonly type?: string } | null;
};

export type StartMobileHostedAuth = (input: {
  readonly mode: 'sign-in';
}) => Promise<MobileHostedAuthResult>;

export type MobileHostedSignInOutcome = 'session_created' | 'not_completed';

export async function startMobileHostedSignIn(
  startHostedAuth: StartMobileHostedAuth,
): Promise<MobileHostedSignInOutcome> {
  const result = await startHostedAuth({ mode: 'sign-in' });
  return result.createdSessionId ? 'session_created' : 'not_completed';
}
