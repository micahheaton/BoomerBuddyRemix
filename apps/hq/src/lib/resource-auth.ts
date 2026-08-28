import { enforceProductionResourceAuthentication } from '@boomerbuddy/security';
import { auth } from '@clerk/nextjs/server';

export async function protectProductionHqResource(): Promise<void> {
  return enforceProductionResourceAuthentication(process.env.NODE_ENV, async () => {
    await auth.protect({ unauthenticatedUrl: '/sign-in' });
  });
}
