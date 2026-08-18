'use client';

import { useClerk } from '@clerk/nextjs';
import { useState } from 'react';
import { apiRequest, setSelectedHouseholdId } from '../lib/api';

export function ProductionSignOut() {
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await apiRequest('/v1/sessions/current', { method: 'DELETE' });
    } catch {
      // Clerk remains the upstream session authority. Always revoke it even if the local
      // session record is already unavailable or the API cannot be reached.
    } finally {
      setSelectedHouseholdId('');
      await clerk.signOut({ redirectUrl: '/sign-in' });
    }
  }

  return (
    <button className="button-secondary" type="button" disabled={busy} onClick={signOut}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
