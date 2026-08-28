import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../../components/public-shell';
import { indexedCustomerPageMetadata } from '../../lib/public-page-metadata';

export const metadata = indexedCustomerPageMetadata['/how-it-works'];

export default function HowItWorksPage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <section className="page-shell how-hero">
          <span className="eyebrow">How it works</span>
          <h1 className="page-title">A simple family plan for uncertain moments</h1>
          <p className="lede">
            Prepare before something feels urgent, check only what you choose to submit, and involve
            one trusted person only when you want their help.
          </p>
          <div className="button-row">
            <Link className="button button-primary" href="/pricing">
              See the Family plan
            </Link>
            <Link className="button button-secondary" href="/check">
              Try Public Check free
            </Link>
          </div>
        </section>

        <section className="section section-alt">
          <div className="page-shell section-shell">
            <h2 className="section-heading">From preparation to follow-through</h2>
            <div className="card-grid workflow-grid">
              <article className="card">
                <div className="step-number">1</div>
                <h3>Prepare</h3>
                <p>
                  Complete short lessons, review dated guidance, choose someone you trust, and set a
                  Family Safe Word if you want one.
                </p>
              </article>
              <article className="card">
                <div className="step-number">2</div>
                <h3>Pause and check</h3>
                <p>
                  Paste message text or a website address. BoomerBuddy explains warning signs,
                  unknowns, and safer actions without opening the submitted address.
                </p>
              </article>
              <article className="card">
                <div className="step-number">3</div>
                <h3>Connect by choice</h3>
                <p>
                  Share only a redacted result with one exact Trusted Circle person. Other household
                  members do not automatically gain access.
                </p>
              </article>
              <article className="card">
                <div className="step-number">4</div>
                <h3>Follow through</h3>
                <p>
                  The chosen person can acknowledge review in the app. The owner can record that the
                  concern was handled; closure is self-reported.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="page-shell section-shell">
          <div className="section-copy">
            <span className="eyebrow">Between suspicious messages</span>
            <h2 className="section-heading">Practice a safer response before pressure hits</h2>
          </div>
          <div className="card-grid">
            <article className="card">
              <h3>Learn at your pace</h3>
              <p>
                Seven short lessons turn common scam patterns into practical pause-and-verify
                habits.
              </p>
            </article>
            <article className="card">
              <h3>Review current guidance</h3>
              <p>
                Read dated, source-linked US guidance, with state guidance only where reviewed
                content is available.
              </p>
            </article>
            <article className="card">
              <h3>Use a weekly practice prompt</h3>
              <p>
                Choose whether to show a short pause-and-verify prompt in the in-app learning feed.
                This does not send an email, text message, or push notification.
              </p>
            </article>
          </div>
        </section>

        <section className="section section-alt">
          <div className="page-shell section-shell boundary-grid">
            <div>
              <h2 className="section-heading">What stays under your control</h2>
              <ul className="plain-list">
                <li>Whether to participate, submit, save, or share</li>
                <li>The exact Trusted Circle person who can see a redacted result</li>
                <li>Whether to use a Family Safe Word or weekly in-app rehearsal</li>
                <li>When to revoke sharing or end a Trusted Circle relationship</li>
              </ul>
            </div>
            <div>
              <h2 className="section-heading">Important limits</h2>
              <ul className="plain-list">
                <li>BoomerBuddy does not prove that a message is safe or fraudulent.</li>
                <li>It does not monitor calls, messages, contacts, accounts, or location.</li>
                <li>
                  It does not automatically email, text, or remotely push Trusted Circle alerts.
                </li>
                <li>It does not contact a bank, agency, or emergency service for you.</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
