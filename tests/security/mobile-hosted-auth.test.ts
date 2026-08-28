import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  isMobileHostedAuthCallbackUrl,
  mobileHostedAuthRedirectUrl,
  startMobileHostedSignIn,
  type StartMobileHostedAuth,
} from '../../apps/mobile/src/hosted-auth';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('mobile hosted sign-in', () => {
  it('requests the Clerk sign-in flow and recognizes the created native session', async () => {
    const startHostedAuth = vi.fn<StartMobileHostedAuth>(async () => ({
      createdSessionId: 'synthetic-session',
    }));

    await expect(startMobileHostedSignIn(startHostedAuth, 'ios')).resolves.toBe('session_created');
    expect(startHostedAuth).toHaveBeenCalledExactlyOnceWith({
      mode: 'sign-in',
      redirectUrl: 'net.boomerbuddy.app://callback',
    });
  });

  it.each([
    ['browser cancellation', { createdSessionId: null, authSessionResult: { type: 'cancel' } }],
    [
      'completed callback without a session',
      { createdSessionId: null, authSessionResult: { type: 'success' } },
    ],
  ] as const)('%s remains signed out', async (_label, result) => {
    const startHostedAuth = vi.fn<StartMobileHostedAuth>(async () => result);

    await expect(startMobileHostedSignIn(startHostedAuth, 'android')).resolves.toBe(
      'not_completed',
    );
  });

  it('propagates a hosted-auth failure for the screen safe-error boundary', async () => {
    const failure = new Error('synthetic hosted-auth failure');
    const startHostedAuth = vi.fn<StartMobileHostedAuth>(async () => {
      throw failure;
    });

    await expect(startMobileHostedSignIn(startHostedAuth, 'ios')).rejects.toBe(failure);
  });

  it('pins canonical provider callbacks and recognizes only their exact route', () => {
    expect(mobileHostedAuthRedirectUrl('ios')).toBe('net.boomerbuddy.app://callback');
    expect(mobileHostedAuthRedirectUrl('android')).toBe(
      'clerk://net.boomerbuddy.app.hosted-callback',
    );
    expect(
      isMobileHostedAuthCallbackUrl(
        'net.boomerbuddy.app://callback?state=synthetic&rotating_token_nonce=synthetic',
      ),
    ).toBe(true);
    expect(
      isMobileHostedAuthCallbackUrl('clerk://net.boomerbuddy.app.hosted-callback?state=synthetic'),
    ).toBe(true);
    for (const lookalike of [
      'https://net.boomerbuddy.app/callback',
      'net.boomerbuddy.app://callback/extra',
      'clerk://net.boomerbuddy.app.hosted-callback.evil',
      'clerk://user@net.boomerbuddy.app.hosted-callback',
      'net.boomerbuddy.app://callback\\payload',
    ]) {
      expect(isMobileHostedAuthCallbackUrl(lookalike)).toBe(false);
    }
  });

  it('binds the member sign-in screen to the tested adapter and safe error copy', () => {
    const screen = source('apps/mobile/src/screens.tsx');

    expect(screen).toContain("import { startMobileHostedSignIn } from './hosted-auth';");
    expect(screen)
      .toContain(`      const outcome = await startMobileHostedSignIn(startHostedAuth, Platform.OS);
      if (outcome === 'not_completed') {
        setError('Sign-in was not completed. You can try again when you are ready.');
      }
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }`);
  });
});
