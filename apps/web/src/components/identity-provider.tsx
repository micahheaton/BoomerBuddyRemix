import { canonicalPublicOrigin } from '@boomerbuddy/config/exact-origin';
import { ClerkProvider } from '@clerk/nextjs';

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (process.env.NODE_ENV !== 'production') return children;

  const publicOrigin = canonicalPublicOrigin(process.env.BB_PUBLIC_ORIGIN, true);
  if (!publishableKey || !publicOrigin) {
    return <main role="alert">Member sign in is temporarily unavailable.</main>;
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-in"
      signInFallbackRedirectUrl="/member"
      signUpFallbackRedirectUrl="/member"
      afterSignOutUrl="/sign-in"
      allowedRedirectOrigins={[publicOrigin]}
    >
      {children}
    </ClerkProvider>
  );
}
