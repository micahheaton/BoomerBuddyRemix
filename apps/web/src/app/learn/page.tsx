import Link from 'next/link';
import { memberLearningLessons } from '@boomerbuddy/domain';
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
            Start with seven practical habits for common scam situations. Members with active access
            can work through the full interactive lessons, save progress, and return for short
            reviews.
          </p>
        </section>
        <section className="section section-alt">
          <div className="page-shell section-shell">
            <div className="section-copy">
              <span className="eyebrow">Seven short safety lessons</span>
              <h2 className="section-heading">Practice the next safe move before pressure hits</h2>
              <p className="section-lede">
                Each lesson takes about three to five minutes, uses a realistic choice, and ends
                with one action worth remembering. No account is required to preview the habits.
              </p>
            </div>
            <div className="card-grid">
              {memberLearningLessons.map((lesson) => (
                <article className="card" key={lesson.key}>
                  <span className="data-pill">
                    Lesson {lesson.order} - about {lesson.estimatedMinutes} minutes
                  </span>
                  <h3>{lesson.title}</h3>
                  <p>{lesson.objective}</p>
                  <p>
                    <strong>Remember:</strong> {lesson.takeaway}
                  </p>
                  <p className="help">
                    Source:{' '}
                    {lesson.sources.map((source, index) => (
                      <span key={source.url}>
                        {index > 0 ? ' and ' : ''}
                        <a href={source.url} rel="noreferrer" target="_blank">
                          {source.title}
                        </a>
                      </span>
                    ))}
                  </p>
                </article>
              ))}
            </div>
            <div className="button-row">
              <Link className="button button-primary" href="/sign-up">
                Create a free account before choosing a plan
              </Link>
              <Link className="button button-secondary" href="/check">
                Try a free Check
              </Link>
            </div>
          </div>
        </section>
        <section className="page-shell section-shell">
          <div className="section-copy">
            <span className="eyebrow">Reviewed scam guidance</span>
            <h2 className="section-heading">Source-linked updates and recovery guidance</h2>
            <p className="section-lede">
              Additional articles are published only after human review of dated government or
              law-enforcement guidance.
            </p>
          </div>
          {articles.length === 0 ? (
            <div className="card" role="status">
              <h3>More reviewed articles are being prepared</h3>
              <p>
                Nothing is published automatically. The seven safety habits above are available now
                while additional source-linked articles complete review.
              </p>
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
