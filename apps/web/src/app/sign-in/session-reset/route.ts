import { canonicalPublicOrigin } from '@boomerbuddy/config/exact-origin';
import { NextResponse } from 'next/server';

interface SessionResetEnvironment {
  readonly BB_PUBLIC_ORIGIN?: string;
  readonly NODE_ENV?: string;
}

export function resetCustomerBrowserSession(
  request: Request,
  environment: SessionResetEnvironment,
): Response {
  const production = environment.NODE_ENV === 'production';
  const configuredOrigin = canonicalPublicOrigin(environment.BB_PUBLIC_ORIGIN, production);
  if (configuredOrigin === undefined) {
    return NextResponse.json(
      { error: 'Member sign in is temporarily unavailable.' },
      { status: 503, headers: { 'cache-control': 'private, no-store' } },
    );
  }

  if (request.headers.get('origin') !== configuredOrigin) {
    return NextResponse.json(
      { error: 'The browser session reset was rejected.' },
      {
        status: 403,
        headers: { 'cache-control': 'private, no-store', vary: 'origin' },
      },
    );
  }

  const response = NextResponse.json(
    { reset: true },
    {
      status: 200,
      headers: { 'cache-control': 'private, no-store', vary: 'origin' },
    },
  );
  response.cookies.set('__session', '', {
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    secure: production,
  });
  return response;
}

export function POST(request: Request): Response {
  return resetCustomerBrowserSession(request, process.env);
}
