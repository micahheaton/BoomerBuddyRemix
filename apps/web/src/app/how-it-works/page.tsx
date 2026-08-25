import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../../components/public-shell';

export default function HowItWorksPage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">How it works</span>
        <h1 className="page-title">A calmer way to handle something suspicious</h1>
        <p className="lede">
          BoomerBuddy is decision support, not a guarantee. Public Check works without an account. A
          temporary result is saved to a household only when an invited member signs in and
          deliberately chooses Save.
        </p>
        <div className="card-grid" style={{ marginTop: '2rem' }}>
          <article className="card">
            <div className="step-number">1</div>
            <h2>Pause</h2>
            <p>Do not click, reply, pay, download software, or share a one-time code.</p>
          </article>
          <article className="card">
            <div className="step-number">2</div>
            <h2>Check</h2>
            <p>
              Choose message text or a website address. The result explains what it noticed, what it
              could not determine, and safer actions.
            </p>
          </article>
          <article className="card">
            <div className="step-number">3</div>
            <h2>Connect</h2>
            <p>
              Verify independently or ask a Trusted Circle member to help. Consent can be changed
              later.
            </p>
          </article>
        </div>
        <section className="section">
          <h2 className="section-heading">What BoomerBuddy does not do</h2>
          <ul className="plain-list">
            <li>
              It does not open the website address you enter or look it up with an outside service.
            </li>
            <li>It does not prove a message is safe or identify every scam.</li>
            <li>It does not ingest native share-sheet content or send invitations or alerts.</li>
            <li>Its result can miss warning signs or flag something harmless.</li>
          </ul>
          <div className="button-row">
            <Link className="button button-primary" href="/check">
              Use anonymous Public Check
            </Link>
            <Link className="button button-secondary" href="/sign-in">
              Member sign in
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
