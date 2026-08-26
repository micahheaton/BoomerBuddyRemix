export const hqNonPageCrawlBlocks = ['/api/'] as const;

export const hqCrawlerPolicy = {
  rules: {
    userAgent: '*',
    disallow: hqNonPageCrawlBlocks,
  },
} as const;
