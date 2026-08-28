import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../components/public-shell';
import { indexedCustomerPageMetadata } from '../lib/public-page-metadata';

export const metadata = indexedCustomerPageMetadata['/'];

export default function HomePage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <section className="page-shell marketing-hero">
          <div>
            <span className="eyebrow">Scam-safety support for older adults and families</span>
            <h1>Handle suspicious messages with a calmer family plan.</h1>
            <p className="lede">
              Family combines seven short safety lessons, a private place to check suspicious text
              or links, and optional help from a person each adult chooses and trusts.
            </p>
            <p className="offer-line" aria-label="Family plan offer">
              <strong>Family</strong>
              <span>USD 14.99/month</span>
              <span>One invited household</span>
            </p>
            <div className="button-row">
              <Link className="button button-primary" href="/pricing">
                See what Family includes
              </Link>
              <Link className="button button-secondary" href="/check">
                Try a free Check
              </Link>
            </div>
            <p className="help">
              Private by design: BoomerBuddy does not monitor your phone, read your messages, or
              contact family automatically. A Check explains warning signs and safer actions; it
              cannot guarantee that something is safe.
            </p>
          </div>
          <aside className="hero-card workflow-card" aria-label="The Family response plan">
            <span className="data-pill">A plan before the pressure</span>
            <h2>A simple habit when something feels wrong</h2>
            <ol className="workflow-list">
              <li>
                <strong>Learn</strong>
                <span>Practice common scam situations before one feels urgent.</span>
              </li>
              <li>
                <strong>Check</strong>
                <span>Review warning signs and safer next actions.</span>
              </li>
              <li>
                <strong>Ask by choice</strong>
                <span>Share a summary with the original message or link removed.</span>
              </li>
              <li>
                <strong>Follow through</strong>
                <span>See when they acknowledge it and record when the concern is handled.</span>
              </li>
            </ol>
          </aside>
        </section>

        <section className="section section-alt">
          <div className="page-shell section-shell">
            <div className="section-copy">
              <span className="eyebrow">Ongoing household value</span>
              <h2 className="section-heading">Family is more than a checker</h2>
              <p className="section-lede">
                Prepare together before something suspicious arrives, then use a clear, private plan
                when it does.
              </p>
            </div>
            <div className="card-grid value-grid">
              <article className="card">
                <h3>Seven short lessons</h3>
                <p>
                  Practice handling urgency, impersonation, passwords and codes, unusual payment
                  requests, remote access, and recovery without shame.
                </p>
              </article>
              <article className="card">
                <h3>Reviewed scam guidance</h3>
                <p>
                  Read dated, source-linked US guidance, including a reviewed California brief.
                  Broader regional coverage is still being added.
                </p>
              </article>
              <article className="card">
                <h3>Weekly practice prompt</h3>
                <p>
                  Choose whether to show a short weekly pause-and-verify prompt in the member&apos;s
                  in-app learning feed.
                </p>
              </article>
              <article className="card">
                <h3>Private Check history</h3>
                <p>
                  Save eligible Checks for up to 30 days, revisit safer actions, and record when a
                  concern has been handled.
                </p>
              </article>
              <article className="card">
                <h3>Trusted Circle help</h3>
                <p>
                  Share a summary with the original message or link removed. Only the person you
                  chose can review and acknowledge it in the app.
                </p>
              </article>
              <article className="card">
                <h3>Family Safe Word</h3>
                <p>
                  Agree on an optional private phrase for family-emergency conversations. It is a
                  social aid, not proof of identity.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="page-shell section-shell">
          <div className="section-copy">
            <span className="eyebrow">Consent comes first</span>
            <h2 className="section-heading">Help without taking control</h2>
            <p className="section-lede">
              Every adult chooses whether to participate and what to share. Paying for or managing a
              household does not reveal another adult&apos;s Checks.
            </p>
          </div>
          <div className="audience-grid">
            <article className="card">
              <h3>When you receive something suspicious</h3>
              <p>
                Get a calm second look without being judged, rushed, monitored, or asked to give up
                control of your account.
              </p>
            </article>
            <article className="card">
              <h3>When someone asks you for help</h3>
              <p>
                See only the summary they chose to share, with the original message or link removed,
                and help them choose a safer next step.
              </p>
            </article>
          </div>
          <div className="notice consent-note">
            <strong>Private by default. Shared on purpose.</strong> BoomerBuddy examines only the
            text or website address someone deliberately submits. It does not continuously monitor
            messages, calls, contacts, accounts, or location.{' '}
            <Link href="/trust">See the trust boundaries</Link>.
          </div>
        </section>

        <section className="section section-alt">
          <div className="page-shell section-shell">
            <div className="section-copy">
              <span className="eyebrow">Choose what fits now</span>
              <h2 className="section-heading">
                Use Public Check now. Add Family for an ongoing plan.
              </h2>
            </div>
            <div className="comparison-grid">
              <article className="card plan-card">
                <p className="plan-kicker">No account required</p>
                <h3>Public Check</h3>
                <p className="plan-price">Free</p>
                <ul className="plain-list">
                  <li>Check message text or a website address</li>
                  <li>See warning signs, uncertainty, and safer actions</li>
                  <li>Temporary by default</li>
                  <li>No household collaboration</li>
                </ul>
                <Link className="button button-secondary" href="/check">
                  Try a free Check
                </Link>
              </article>
              <article className="card plan-card plan-card-featured">
                <p className="plan-kicker">Invitation required</p>
                <h3>Family</h3>
                <p className="plan-price">USD 14.99/month</p>
                <ul className="plain-list">
                  <li>One invited household</li>
                  <li>Private History for up to 30 days and sharing only by choice</li>
                  <li>See when your chosen person acknowledges a shared summary</li>
                  <li>Safe Word, seven lessons, guidance, and weekly practice</li>
                </ul>
                <Link className="button button-primary" href="/pricing">
                  See what Family includes
                </Link>
              </article>
            </div>
          </div>
        </section>

        <section className="page-shell closing-section">
          <div>
            <span className="eyebrow">A clearer next step</span>
            <h2 className="section-heading">Build the habit before the next urgent message.</h2>
            <p>
              Family access is currently limited to invited households. Web access is the controlled
              early-access path; native iPhone and Android packages are still completing
              signed-device and store testing.
            </p>
          </div>
          <div className="button-row">
            <Link className="button button-primary" href="/pricing">
              Review Family access
            </Link>
            <Link className="button button-secondary" href="/sign-in">
              Already invited? Sign in
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
