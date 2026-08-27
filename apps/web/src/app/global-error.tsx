'use client';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main id="main-content" className="page-shell">
          <section className="card form-stack" aria-labelledby="global-error-heading">
            <p className="eyebrow">BoomerBuddy recovery</p>
            <h1 id="global-error-heading" className="page-title">
              BoomerBuddy could not display this page.
            </h1>
            <p>
              Your action has not been confirmed. Try again before repeating anything that could
              change your account or billing.
            </p>
            <div className="button-row">
              <button className="button-primary" type="button" onClick={reset}>
                Try again
              </button>
              <a className="button button-secondary" href="/">
                Go to BoomerBuddy home
              </a>
            </div>
            <p>
              If the page still does not continue, visit <a href="/support">support</a>. Do not
              include passwords, access codes, payment details, or suspicious-message content.
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}
