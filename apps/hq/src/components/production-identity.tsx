'use client';

import { SignIn, useAuth, useClerk } from '@clerk/nextjs';
import { useState } from 'react';
import { apiPaths } from '@boomerbuddy/contracts';
import { hqRequest } from '../lib/api';

export function ProductionHqSignIn() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <main id="hq-main" className="sign-in-shell">
        <p role="status">Preparing secure HQ sign in…</p>
      </main>
    );
  }

  if (isSignedIn) {
    return (
      <main id="hq-main" className="sign-in-shell">
        <div className="sign-in-card">
          <span className="seed-label">Access denied</span>
          <h1>BoomerBuddy HQ</h1>
          <p className="error" role="alert">
            Clerk authenticated this identity, but BoomerBuddy did not find the exact active founder
            binding and required recent multi-factor verification. HQ remains closed.
          </p>
          <ProductionHqSignOut onSignedOut={() => window.location.reload()} />
        </div>
      </main>
    );
  }

  return (
    <main id="hq-main" className="sign-in-shell">
      <div className="sign-in-card">
        <span className="seed-label">Founder-only early access</span>
        <h1>BoomerBuddy HQ</h1>
        <p>
          Use the separately configured HQ Clerk identity. Customer identities and development
          personas cannot enter this control plane.
        </p>
        <SignIn
          path="/sign-in"
          routing="path"
          withSignUp={false}
          forceRedirectUrl="/"
          fallbackRedirectUrl="/"
        />
      </div>
    </main>
  );
}

export function ProductionHqSignOut({ onSignedOut }: { onSignedOut: () => void }) {
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await hqRequest(apiPaths.currentSession, { method: 'DELETE' });
    } catch {
      // Always revoke Clerk's upstream session even if the local session is already unavailable.
    } finally {
      await clerk.signOut({ redirectUrl: '/sign-in' });
      onSignedOut();
    }
  }

  return (
    <button className="secondary" type="button" disabled={busy} onClick={signOut}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
