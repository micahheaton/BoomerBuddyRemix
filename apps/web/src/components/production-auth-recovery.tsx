'use client';

import { useClerk } from '@clerk/nextjs';
import { useLayoutEffect } from 'react';
import {
  clearClerkSessionAndNavigate,
  clearClerkSessionWhenLoaded,
  productionSessionRecoveryPath,
  registerProductionAuthenticationRecovery,
} from '../lib/auth-recovery';

export function ProductionAuthenticationRecovery({ children }: { children: React.ReactNode }) {
  const clerk = useClerk();

  useLayoutEffect(
    () =>
      registerProductionAuthenticationRecovery(async () => {
        await clearClerkSessionAndNavigate({
          clearClerkSession: () =>
            clearClerkSessionWhenLoaded({
              clearClerkSession: () => clerk.signOut(),
              isLoaded: () => clerk.loaded,
            }),
          navigate: () => window.location.replace(productionSessionRecoveryPath),
        });
      }),
    [clerk],
  );

  return children;
}
