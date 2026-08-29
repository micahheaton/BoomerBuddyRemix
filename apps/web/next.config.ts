import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? '',
    // Pin Clerk's remote browser and UI bundles to the exact pair embedded by the reviewed,
    // locked @clerk/nextjs dependency so every production release loads one deterministic pair.
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
