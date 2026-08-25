import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/accessibility',
  '/account-deletion',
  '/billing-terms',
  '/check(.*)',
  '/feedback',
  '/how-it-works',
  '/pricing',
  '/privacy',
  '/sign-in(.*)',
  '/support',
  '/terms',
  '/trust',
  '/api(.*)',
]);
const productionClerkSignInUrl = '/sign-in';
const configuredClerkSignInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
const productionClerkMiddleware = clerkMiddleware(
  async (auth, request) => {
    if (!isPublicRoute(request)) await auth.protect();
  },
  { signInUrl: productionClerkSignInUrl },
);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY ||
    configuredClerkSignInUrl !== productionClerkSignInUrl
  ) {
    return new NextResponse('Production identity is unavailable.', {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }

  return productionClerkMiddleware(request, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api)(.*)',
  ],
};
