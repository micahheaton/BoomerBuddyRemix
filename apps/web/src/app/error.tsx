'use client';

import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../components/public-shell';

export default function CustomerError({ reset }: { reset: () => void }) {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell">
        <section className="card form-stack" aria-labelledby="customer-error-heading">
          <span className="eyebrow">Page recovery</span>
          <h1 id="customer-error-heading" className="page-title">
            This page did not finish loading.
          </h1>
          <p>
            Your action has not been confirmed. Try the page again before repeating anything that
            could change your account or billing.
          </p>
          <div className="button-row">
            <button className="button-primary" type="button" onClick={reset}>
              Try again
            </button>
            <Link className="button button-secondary" href="/">
              Go to BoomerBuddy home
            </Link>
          </div>
          <p>
            If the page still does not continue, visit <Link href="/support">support</Link>. Do not
            include passwords, access codes, payment details, or suspicious-message content.
          </p>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
