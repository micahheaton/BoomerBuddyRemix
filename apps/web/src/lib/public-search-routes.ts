export const customerPublicOrigin = 'https://app.boomerbuddy.net';

export const indexedCustomerRoutes = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/check', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/how-it-works', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/trust', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/support', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/privacy', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/terms', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/billing-terms', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/accessibility', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/account-deletion', changeFrequency: 'monthly', priority: 0.5 },
] as const;

export type IndexedCustomerRoutePath = (typeof indexedCustomerRoutes)[number]['path'];

export type IndexedCustomerChangeFrequency =
  (typeof indexedCustomerRoutes)[number]['changeFrequency'];

export type IndexedCustomerSitemapEntry = {
  readonly url: string;
  readonly changeFrequency: IndexedCustomerChangeFrequency;
  readonly priority: number;
};

export const noindexCustomerRoutePrefixes = [
  '/feedback',
  '/member',
  '/research',
  '/sign-in',
  '/unauthorized-sign-in',
] as const;

export const nonPageCustomerCrawlBlocks = ['/api/'] as const;

export const indexedCustomerSitemapEntries: readonly IndexedCustomerSitemapEntry[] =
  indexedCustomerRoutes.map((route) => ({
    url: `${customerPublicOrigin}${route.path === '/' ? '' : route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

export const customerCrawlerPolicy = {
  rules: {
    userAgent: '*',
    disallow: nonPageCustomerCrawlBlocks,
  },
  sitemap: `${customerPublicOrigin}/sitemap.xml`,
  host: customerPublicOrigin,
} as const;
