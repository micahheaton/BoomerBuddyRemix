'use client';

import { useAuth, useClerk } from '@clerk/nextjs';
import { useLayoutEffect } from 'react';
import {
  clearActiveClerkSession,
  clearClerkSessionAndNavigate,
  clearClerkSessionWhenLoaded,
  productionSessionRecoveryPath,
  registerProductionAuthenticationRecovery,
} from '../lib/auth-recovery';

export function ProductionAuthenticationRecovery({ children }: { children: React.ReactNode }) {
  const clerk = useClerk();
  const { sessionId } = useAuth();

  useLayoutEffect(
    () =>
      registerProductionAuthenticationRecovery(async () => {
        await clearClerkSessionAndNavigate({
          clearClerkSession: () =>
            clearClerkSessionWhenLoaded({
              clearClerkSession: () =>
                clearActiveClerkSession({
                  sessionId,
                  signOut: (callback, options) => clerk.signOut(callback, options),
                }),
              isLoaded: () => clerk.loaded,
            }),
          navigate: () => window.location.replace(productionSessionRecoveryPath),
        });
      }),
    [clerk, sessionId],
  );

  return children;
}
