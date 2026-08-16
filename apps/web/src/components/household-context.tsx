'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { FamilyResponse, MeResponse, PrincipalDto } from '@boomerbuddy/contracts';
import {
  apiRequest,
  readSelectedHouseholdId,
  readableError,
  setSelectedHouseholdId,
} from '../lib/api';

type HouseholdScope = PrincipalDto['households'][number];
type PrincipalRefresh = { me: MeResponse; selectedHouseholdId: string };

type HouseholdContextValue = {
  me: MeResponse;
  selectedHouseholdId: string;
  selectedScope: HouseholdScope | undefined;
  selectedHouseholdName: string;
  householdName: (householdId: string, index: number) => string;
  selectHousehold: (householdId: string) => void;
  refreshPrincipal: (preferredHouseholdId?: string) => Promise<PrincipalRefresh>;
};

const HouseholdContext = createContext<HouseholdContextValue | undefined>(undefined);

function fallbackName(index: number): string {
  return `Household ${index + 1}`;
}

export function householdScopeSummary(scope: HouseholdScope): string {
  return [
    'member',
    scope.isAdministrator ? 'administrator' : '',
    scope.isProtectedMember ? 'protected adult' : '',
    scope.isPayer ? 'payer' : '',
    scope.isBillingManager ? 'billing manager' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeResponse>();
  const [selectedHouseholdId, setSelectedId] = useState('');
  const [householdNames, setHouseholdNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const refreshPrincipal = useCallback(
    async (preferredHouseholdId?: string): Promise<PrincipalRefresh> => {
      const response = await apiRequest<MeResponse>('/v1/me');
      const stored = readSelectedHouseholdId();
      const selectedScope =
        response.principal.households.find((scope) => scope.id === preferredHouseholdId) ??
        response.principal.households.find((scope) => scope.id === stored) ??
        response.principal.households[0];
      const nextSelectedId = selectedScope?.id ?? '';
      setSelectedHouseholdId(nextSelectedId);

      const nameEntries = await Promise.all(
        response.principal.households.map(async (scope, index) => {
          try {
            const family = await apiRequest<FamilyResponse>('/v1/family', {
              headers: { 'X-BB-Household-Id': scope.id },
            });
            return [scope.id, family.household.name] as const;
          } catch {
            return [scope.id, fallbackName(index)] as const;
          }
        }),
      );

      setHouseholdNames(Object.fromEntries(nameEntries));
      setMe(response);
      setSelectedId(nextSelectedId);
      return { me: response, selectedHouseholdId: nextSelectedId };
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshPrincipal().catch((caught) => setError(readableError(caught)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshPrincipal]);

  const selectHousehold = useCallback(
    (householdId: string) => {
      if (!me?.principal.households.some((scope) => scope.id === householdId)) return;
      setSelectedHouseholdId(householdId);
      setSelectedId(householdId);
      window.location.reload();
    },
    [me],
  );

  const selectedScope = me?.principal.households.find((scope) => scope.id === selectedHouseholdId);
  const value = useMemo<HouseholdContextValue | undefined>(
    () =>
      me
        ? {
            me,
            selectedHouseholdId,
            selectedScope,
            selectedHouseholdName: selectedHouseholdId
              ? (householdNames[selectedHouseholdId] ?? 'Selected household')
              : '',
            householdName: (householdId, index) =>
              householdNames[householdId] ?? fallbackName(index),
            selectHousehold,
            refreshPrincipal,
          }
        : undefined,
    [householdNames, me, refreshPrincipal, selectHousehold, selectedHouseholdId, selectedScope],
  );

  if (error) {
    return (
      <main id="main-content" className="member-shell member-main">
        <h1 className="member-heading">Your local session is unavailable</h1>
        <p className="error" role="alert">
          {error}
        </p>
        <Link className="button button-primary" href="/sign-in">
          Return to development sign in
        </Link>
      </main>
    );
  }

  if (!value) {
    return (
      <main id="main-content" className="member-shell member-main">
        <p role="status">Preparing your selected household…</p>
      </main>
    );
  }

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const context = useContext(HouseholdContext);
  if (!context) throw new Error('useHousehold must be used inside HouseholdProvider.');
  return context;
}

export function HouseholdScopeBanner() {
  const { selectedHouseholdName, selectedScope } = useHousehold();
  if (!selectedScope) return null;
  return (
    <p className="scope-banner" data-testid="active-household">
      Active household: <strong>{selectedHouseholdName}</strong> ·{' '}
      {householdScopeSummary(selectedScope)}
    </p>
  );
}
