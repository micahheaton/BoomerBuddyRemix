import type { MetadataRoute } from 'next';
import { customerCrawlerPolicy } from '../lib/public-search-routes';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: customerCrawlerPolicy.rules.userAgent,
      disallow: [...customerCrawlerPolicy.rules.disallow],
    },
    sitemap: customerCrawlerPolicy.sitemap,
    host: customerCrawlerPolicy.host,
  };
}
