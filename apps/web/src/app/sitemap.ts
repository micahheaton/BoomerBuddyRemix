import type { MetadataRoute } from 'next';
import { indexedCustomerSitemapEntries } from '../lib/public-search-routes';

export default function sitemap(): MetadataRoute.Sitemap {
  return indexedCustomerSitemapEntries.map((entry) => ({ ...entry }));
}
