'use client';

import { useClerk } from '@clerk/nextjs';
import { useLayoutEffect } from 'react';
import {
  clearClerkClientSessions,
  clearClerkSessionAndNavigate,
  clearClerkSessionWhenLoaded,
  clearClerkSessionsWithLocalFallback,
  productionSessionRecoveryPath,
  registerProductionAuthenticationRecovery,
  resetBrowserClerkSession,
} from '../lib/auth-recovery';

export function ProductionAuthenticationRecovery({ children }: { children: React.ReactNode }) {
  const clerk = useClerk();

  useLayoutEffect(
    () =>
      registerProductionAuthenticationRecovery(async () => {
        await clearClerkSessionAndNavigate({
          clearClerkSession: () =>
            clearClerkSessionsWithLocalFallback({
              clearClerkSessions: () =>
                clearClerkSessionWhenLoaded({
                  clearClerkSession: () =>
                    clearClerkClientSessions({
                      signOut: (callback) => clerk.signOut(callback),
                    }),
                  isLoaded: () => clerk.loaded,
                }),
              resetLocalSession: () => resetBrowserClerkSession(),
            }),
          navigate: () => window.location.replace(productionSessionRecoveryPath),
        });
      }),
    [clerk],
  );

  return children;
}
