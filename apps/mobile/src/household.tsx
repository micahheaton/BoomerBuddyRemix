import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { FamilyResponse, PrincipalDto } from '@boomerbuddy/contracts';
import { mobileRequest } from './api';
import {
  isMobileHouseholdSessionCurrent,
  readSelectedHouseholdId,
  setSelectedHouseholdId,
  type MobileHouseholdSession,
} from './session';

type HouseholdScope = PrincipalDto['households'][number];

type HouseholdContextValue = {
  principal: PrincipalDto;
  selectedHouseholdId: string;
  selectedScope: HouseholdScope | undefined;
  selectedHouseholdName: string;
  householdName: (householdId: string, index: number) => string;
  selectHousehold: (householdId: string) => void;
  replacePrincipal: (principal: PrincipalDto, preferredHouseholdId?: string) => string;
};

const HouseholdContext = createContext<HouseholdContextValue | undefined>(undefined);

function fallbackName(index: number): string {
  return `Household ${index + 1}`;
}

export function mobileHouseholdScopeSummary(scope: HouseholdScope): string {
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

export function MobileHouseholdProvider({
  children,
  householdSession,
  principal,
  onPrincipalChanged,
}: {
  children: React.ReactNode;
  householdSession: MobileHouseholdSession;
  principal: PrincipalDto;
  onPrincipalChanged: (principal: PrincipalDto) => void;
}) {
  const initialStored = readSelectedHouseholdId();
  const initialSelected =
    principal.households.find((scope) => scope.id === initialStored)?.id ??
    principal.households[0]?.id ??
    '';
  const [selectedHouseholdId, setSelectedId] = useState(initialSelected);
  const [householdNames, setHouseholdNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void Promise.all(
      principal.households.map(async (scope, index) => {
        try {
          const family = await mobileRequest<FamilyResponse>('/v1/family', {
            headers: { 'X-BB-Household-Id': scope.id },
          });
          return [scope.id, family.household.name] as const;
        } catch {
          return [scope.id, fallbackName(index)] as const;
        }
      }),
    ).then((entries) => {
      if (active) setHouseholdNames(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [principal]);

  function selectHousehold(householdId: string) {
    if (!isMobileHouseholdSessionCurrent(householdSession)) return;
    if (!principal.households.some((scope) => scope.id === householdId)) return;
    void setSelectedHouseholdId(householdSession, principal.personId, householdId).catch(
      () => undefined,
    );
    setSelectedId(householdId);
  }

  const replacePrincipal = useCallback(
    (nextPrincipal: PrincipalDto, preferredHouseholdId?: string): string => {
      if (!isMobileHouseholdSessionCurrent(householdSession)) return selectedHouseholdId;
      const stored = readSelectedHouseholdId();
      const selected =
        nextPrincipal.households.find((scope) => scope.id === preferredHouseholdId)?.id ??
        nextPrincipal.households.find((scope) => scope.id === stored)?.id ??
        nextPrincipal.households[0]?.id ??
        '';
      void setSelectedHouseholdId(householdSession, nextPrincipal.personId, selected || null).catch(
        () => undefined,
      );
      setSelectedId(selected);
      onPrincipalChanged(nextPrincipal);
      return selected;
    },
    [householdSession, onPrincipalChanged, selectedHouseholdId],
  );

  const selectedScope = principal.households.find((scope) => scope.id === selectedHouseholdId);
  const value: HouseholdContextValue = {
    principal,
    selectedHouseholdId,
    selectedScope,
    selectedHouseholdName: selectedHouseholdId
      ? (householdNames[selectedHouseholdId] ?? 'Selected household')
      : '',
    householdName: (householdId, index) => householdNames[householdId] ?? fallbackName(index),
    selectHousehold,
    replacePrincipal,
  };

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useMobileHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext);
  if (!value) throw new Error('useMobileHousehold must be used inside MobileHouseholdProvider.');
  return value;
}

export function useOptionalMobileHousehold(): HouseholdContextValue | undefined {
  return useContext(HouseholdContext);
}
