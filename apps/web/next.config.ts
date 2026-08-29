import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? '',
    // Keep Clerk's browser bundles aligned with the exact versions declared compatible by the
    // locked @clerk/nextjs dependency. Floating major aliases caused production authentication
    // inputs to clear while users typed.
    NEXT_PUBLIC_CLERK_JS_VERSION: '6.30.1',
    NEXT_PUBLIC_CLERK_UI_VERSION: '1.30.8',
  },
  transpilePackages: [
    '@boomerbuddy/config',
    '@boomerbuddy/contracts',
    '@boomerbuddy/design',
    '@boomerbuddy/domain',
  ],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/unauthorized-sign-in',
        destination: '/sign-in/unauthorized-sign-in',
      },
    ];
  },
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
};

export default nextConfig;
