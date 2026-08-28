import { canonicalPublicOrigin } from '@boomerbuddy/config/exact-origin';
import {
  publicLearnArticleSchema,
  publicLearnIndexResponseSchema,
  type PublicLearnArticle,
} from '@boomerbuddy/contracts';

function apiOrigin(): string | undefined {
  return canonicalPublicOrigin(
    process.env.BB_API_INTERNAL_ORIGIN ??
      process.env.NEXT_PUBLIC_API_URL ??
      (process.env.NODE_ENV === 'production' ? undefined : 'http://127.0.0.1:4000'),
    process.env.NODE_ENV === 'production',
  );
}

async function publicLearnRequest(path: string): Promise<Response | undefined> {
  const origin = apiOrigin();
  if (origin === undefined) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(new URL(path, origin), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function publicLearnArticles(): Promise<readonly Omit<PublicLearnArticle, 'body'>[]> {
  const response = await publicLearnRequest('/v1/public/learn');
  if (response === undefined || !response.ok) return [];
  const parsed = publicLearnIndexResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.articles : [];
}

export async function publicLearnArticle(slug: string): Promise<PublicLearnArticle | undefined> {
  const response = await publicLearnRequest(`/v1/public/learn/${encodeURIComponent(slug)}`);
  if (response === undefined || !response.ok) return undefined;
  const parsed = publicLearnArticleSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : undefined;
}
