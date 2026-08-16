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
          BoomerBuddy is decision support, not a guarantee. The local build stores a minimized
          record of each check and never returns the text or URL you submitted.
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
              Choose text or URL. The result names its risk level, confidence, provider state, and
              limitations.
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
          <h2 className="section-heading">What this build does not do</h2>
          <ul className="plain-list">
            <li>It does not visit URLs or contact live reputation services.</li>
            <li>It does not prove a message is safe or identify every scam.</li>
            <li>It does not send invitations, alerts, or native share-sheet content.</li>
            <li>Its confidence labels have not been empirically calibrated.</li>
          </ul>
          <Link className="button button-primary" href="/sign-in">
            Continue to development sign in
          </Link>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
