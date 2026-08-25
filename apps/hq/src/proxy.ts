import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { isExactReplitHqHealthCheck, replitHqLivenessResponse } from './lib/replit-health-check';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)']);
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

  if (
    isExactReplitHqHealthCheck({
      deployment: process.env.REPLIT_DEPLOYMENT,
      forwarded: request.headers.get('forwarded'),
      forwardedFor: request.headers.get('x-forwarded-for'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedPort: request.headers.get('x-forwarded-port'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
      host: request.headers.get('host'),
      method: request.method,
      port: process.env.PORT,
      url: request.url,
    })
  ) {
    return replitHqLivenessResponse(request.method);
  }

  return productionClerkMiddleware(request, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api)(.*)',
  ],
};
