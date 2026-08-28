import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicFooter, PublicHeader } from '../../../components/public-shell';
import { publicLearnArticle } from '../../../lib/public-learn';

interface LearnArticlePageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({ params }: LearnArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await publicLearnArticle(slug);
  if (article === undefined)
    return { title: 'Guidance not found | BoomerBuddy', robots: { index: false } };
  return {
    title: `${article.title} | BoomerBuddy`,
    description: article.summary,
    alternates: { canonical: `/learn/${article.slug}` },
  };
}

export default async function LearnArticlePage({ params }: LearnArticlePageProps) {
  const { slug } = await params;
  const article = await publicLearnArticle(slug);
  if (article === undefined) notFound();
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <article className="page-shell section-shell">
          <Link href="/learn">Back to Learn</Link>
          <span className="eyebrow">Reviewed scam guidance</span>
          <h1 className="page-title">{article.title}</h1>
          <p className="lede">{article.summary}</p>
          <div className="card">
            {article.body
              .split('\n')
              .map((paragraph, index) =>
                paragraph === '' ? null : (
                  <p key={`${article.documentDigest}:${index}`}>{paragraph}</p>
                ),
              )}
          </div>
          <aside className="card section" aria-label="Source and review details">
            <h2>Source and review</h2>
            <p>
              <a href={article.source.url} rel="noreferrer" target="_blank">
                {article.source.title}
              </a>
            </p>
            <p>
              Source published {new Date(article.source.publishedAt).toLocaleDateString()} ·
              BoomerBuddy review {new Date(article.source.reviewedAt).toLocaleDateString()} ·
              article published {new Date(article.publishedAt).toLocaleDateString()}
            </p>
            <p className="help">
              This educational guidance cannot guarantee that a message or request is safe. If
              money, accounts, or personal safety are at risk, pause and use a contact method you
              already trust.
            </p>
          </aside>
        </article>
      </main>
      <PublicFooter />
    </>
  );
}
