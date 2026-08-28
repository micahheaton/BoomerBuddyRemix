import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../components/public-shell';

export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell">
        <section className="card form-stack" aria-labelledby="not-found-heading">
          <span className="eyebrow">Page not found</span>
          <h1 id="not-found-heading" className="page-title">
            That page is not available.
          </h1>
          <p>
            The address may be incomplete or the page may have moved. No account or payment action
            was confirmed by this page.
          </p>
          <div className="button-row">
            <Link className="button button-primary" href="/">
              Go to BoomerBuddy home
            </Link>
            <Link className="button button-secondary" href="/support">
              Open support
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
