import type { MetadataRoute } from 'next';
import { hqCrawlerPolicy } from '../lib/search-policy';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: hqCrawlerPolicy.rules.userAgent,
      disallow: [...hqCrawlerPolicy.rules.disallow],
    },
  };
}
