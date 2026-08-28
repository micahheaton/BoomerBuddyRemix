import type { MetadataRoute } from 'next';
import { customerPublicOrigin, indexedCustomerSitemapEntries } from '../lib/public-search-routes';
import { publicLearnArticles } from '../lib/public-learn';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await publicLearnArticles();
  return [
    ...indexedCustomerSitemapEntries.map((entry) => ({ ...entry })),
    ...articles.map((article) => ({
      url: `${customerPublicOrigin}/learn/${article.slug}`,
      lastModified: new Date(article.publishedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
