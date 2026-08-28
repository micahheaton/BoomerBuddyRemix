import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../../components/public-shell';
import { indexedCustomerPageMetadata } from '../../lib/public-page-metadata';
import { publicLearnArticles } from '../../lib/public-learn';

export const metadata = indexedCustomerPageMetadata['/learn'];

export default async function LearnPage() {
  const articles = await publicLearnArticles();
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <section className="page-shell how-hero">
          <span className="eyebrow">Reviewed scam guidance</span>
          <h1 className="page-title">Learn how to pause, verify, and respond</h1>
          <p className="lede">
            Practical articles based on dated public guidance from government and law-enforcement
            sources. Every article is reviewed by people before it appears here.
          </p>
        </section>
        <section className="page-shell section-shell">
          {articles.length === 0 ? (
            <div className="card" role="status">
              <h2>Reviewed articles are being prepared</h2>
              <p>
                Nothing is published automatically. Try the free Check while the first articles
                complete review.
              </p>
              <Link className="button button-primary" href="/check">
                Try a free Check
              </Link>
            </div>
          ) : (
            <div className="card-grid">
              {articles.map((article) => (
                <article className="card" key={`${article.slug}:${article.documentDigest}`}>
                  <span className="data-pill">
                    Reviewed {new Date(article.source.reviewedAt).toLocaleDateString()}
                  </span>
                  <h2>{article.title}</h2>
                  <p>{article.summary}</p>
                  <Link className="button button-secondary" href={`/learn/${article.slug}`}>
                    Read the guidance
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
