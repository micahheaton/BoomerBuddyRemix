import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../components/public-shell';

export default function HomePage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <section className="page-shell hero">
          <div>
            <span className="eyebrow">Pause · Check · Connect</span>
            <h1>From suspicious to a safer next step, together.</h1>
            <p className="lede">
              BoomerBuddy helps you slow down, check a suspicious text or link, and involve someone
              you trust. Public Check works without an account. It can miss warning signs or flag
              something harmless, so verify independently when money, accounts, or safety are at
              risk.
            </p>
            <div className="button-row">
              <Link className="button button-primary" href="/check">
                Check something now
              </Link>
              <Link className="button button-secondary" href="/how-it-works">
                See how it works
              </Link>
            </div>
          </div>
          <aside className="hero-card" aria-label="What to do right now">
            <span className="dev-pill">A useful pause</span>
            <h2>If a message feels urgent</h2>
            <ol className="plain-list">
              <li>Do not reply, click, pay, or share a code.</li>
              <li>Use contact details you find independently.</li>
              <li>Ask someone you trust before acting.</li>
            </ol>
          </aside>
        </section>
        <section className="section section-alt">
          <div className="page-shell" style={{ paddingBlock: 0 }}>
            <h2 className="section-heading">Clear help, without false certainty</h2>
            <div className="card-grid">
              <article className="card">
                <div className="step-number">1</div>
                <h3>Share safely</h3>
                <p>
                  Use Public Check without signing in. Never include passwords, access codes, or
                  financial details.
                </p>
              </article>
              <article className="card">
                <div className="step-number">2</div>
                <h3>Understand the result</h3>
                <p>
                  See what the check noticed, what it could not determine, and clear next steps.
                </p>
              </article>
              <article className="card">
                <div className="step-number">3</div>
                <h3>Choose a safe action</h3>
                <p>Pause, verify through an official channel, or bring in your Trusted Circle.</p>
              </article>
            </div>
          </div>
        </section>
        <section className="page-shell section">
          <h2 className="section-heading">Built for calm decisions</h2>
          <div className="card-grid two">
            <article className="card">
              <h3>Plain language</h3>
              <p>
                Large controls, clear labels, and no color-only warnings make the experience easier
                to use under pressure.
              </p>
            </article>
            <article className="card">
              <h3>Your people stay in the loop</h3>
              <p>
                Family controls make consent and permissions visible. BoomerBuddy does not
                automatically email or text invitations.
              </p>
            </article>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
