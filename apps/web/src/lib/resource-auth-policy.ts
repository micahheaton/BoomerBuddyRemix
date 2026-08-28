export type CustomerResourceAuthDisposition =
  'delegated-to-api' | 'guarded' | 'public' | 'unclassified';

const exactPublicPaths = new Set([
  '/',
  '/accessibility',
  '/account-deletion',
  '/billing-terms',
  '/check',
  '/feedback',
  '/how-it-works',
  '/pricing',
  '/privacy',
  '/robots.txt',
  '/sitemap.xml',
  '/support',
  '/terms',
  '/trust',
  '/unauthorized-sign-in',
]);

function isPathSegment(pathname: string, segment: string): boolean {
  return pathname === segment || pathname.startsWith(`${segment}/`);
}

export function classifyCustomerResourcePath(pathname: string): CustomerResourceAuthDisposition {
  if (
    exactPublicPaths.has(pathname) ||
    isPathSegment(pathname, '/learn') ||
    isPathSegment(pathname, '/sign-in') ||
    isPathSegment(pathname, '/sign-up')
  ) {
    return 'public';
  }
  if (isPathSegment(pathname, '/api')) return 'delegated-to-api';
  if (isPathSegment(pathname, '/member')) return 'guarded';
  return 'unclassified';
}

export function isPublicCustomerResourcePath(pathname: string): boolean {
  const disposition = classifyCustomerResourcePath(pathname);
  return disposition === 'public' || disposition === 'delegated-to-api';
}
