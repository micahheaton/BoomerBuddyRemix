import {
  canonicalPublicOrigin,
  isCanonicalPublicRequestOrigin,
} from '@boomerbuddy/config/exact-origin';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { isExactReplitHqHealthCheck, replitHqLivenessResponse } from './lib/replit-health-check';
import { isPublicHqResourcePath } from './lib/resource-auth-policy';

const productionClerkSignInUrl = '/sign-in';
const configuredClerkSignInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
const configuredPublicOrigin = canonicalPublicOrigin(process.env.BB_PUBLIC_ORIGIN, true);
const productionClerkMiddleware =
  configuredPublicOrigin === undefined
    ? undefined
    : clerkMiddleware(
        async (auth, request) => {
          if (!isPublicHqResourcePath(request.nextUrl.pathname)) await auth.protect();
        },
        {
          signInUrl: productionClerkSignInUrl,
          authorizedParties: [configuredPublicOrigin],
        },
      );

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY ||
    !configuredPublicOrigin ||
    productionClerkMiddleware === undefined ||
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
  if (
    !isCanonicalPublicRequestOrigin(
      {
        forwarded: request.headers.get('forwarded'),
        forwardedHost: request.headers.get('x-forwarded-host'),
        forwardedPort: request.headers.get('x-forwarded-port'),
        forwardedProto: request.headers.get('x-forwarded-proto'),
        host: request.headers.get('host'),
        url: request.url,
      },
      configuredPublicOrigin,
    )
  ) {
    return new NextResponse('The requested application is unavailable.', {
      status: 421,
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
