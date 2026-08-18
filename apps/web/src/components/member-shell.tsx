'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiRequest, setSelectedHouseholdId } from '../lib/api';
import { Brand } from './brand';
import { householdScopeSummary, useHousehold } from './household-context';
import { ProductionSignOut } from './production-sign-out';

export function MemberHeader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { me, selectedHouseholdId, selectedScope, selectHousehold, householdName } = useHousehold();
  const capabilities = selectedScope?.capabilities ?? [];
  const isProtectedMember = selectedScope?.isProtectedMember === true;
  const canCheck =
    isProtectedMember &&
    (capabilities.includes('check:text') || capabilities.includes('check:url'));
  const canReadHistory =
    capabilities.includes('history:read') &&
    (isProtectedMember ||
      selectedScope?.trustedCircleGrants.some((grant) =>
        grant.permissions.includes('view_shared_checks'),
      ) === true);
  const canUseFamily =
    me.principal.households.length === 0 ||
    selectedScope?.isAdministrator === true ||
    selectedScope?.isProtectedMember === true ||
    (selectedScope?.trustedCircleGrants.length ?? 0) > 0;

  async function signOut() {
    setBusy(true);
    try {
      await apiRequest('/v1/sessions/current', { method: 'DELETE' });
    } finally {
      setSelectedHouseholdId('');
      router.push('/sign-in');
      router.refresh();
    }
  }

  return (
    <header className="member-header">
      <div className="header-inner">
        <Brand href="/member" />
        <nav className="member-nav" aria-label="Member navigation">
          <Link href="/member">Home</Link>
          {canCheck ? <Link href="/member/check">Check</Link> : null}
          {canReadHistory ? <Link href="/member/history">History</Link> : null}
          {canUseFamily ? <Link href="/member/family">Family</Link> : null}
          {process.env.NODE_ENV === 'production' ? (
            <ProductionSignOut />
          ) : (
            <button className="button-secondary" type="button" disabled={busy} onClick={signOut}>
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </nav>
        {me.principal.households.length > 1 && (
          <div className="household-switcher">
            <label htmlFor="member-household">Active household</label>
            <select
              id="member-household"
              value={selectedHouseholdId}
              onChange={(event) => selectHousehold(event.target.value)}
            >
              {me.principal.households.map((scope, index) => (
                <option key={scope.id} value={scope.id}>
                  {householdName(scope.id, index)} — {householdScopeSummary(scope)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </header>
  );
}
