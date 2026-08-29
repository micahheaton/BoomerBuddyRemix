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
            <span className="eyebrow">
              Scam-safety practice and support for older adults and families
            </span>
            <h1>Help your family pause before a scam becomes a loss.</h1>
            <p className="lede">
              Scammers create urgency, impersonate people we trust, and try to isolate us from a
              second opinion. BoomerBuddy helps older adults and families practice, check, and
              respond safely to suspicious messages together.
            </p>
            <p>
              Each adult gets seven short safety lessons, a private way to check suspicious text or
              links, and an optional redacted handoff to one person they choose. During web access,
              you contact that person directly; BoomerBuddy does not message them automatically.
            </p>
            <p className="offer-line" aria-label="Family plan offer">
              <strong>Family</strong>
              <span>7 days free, then USD 149.90/year</span>
              <span>Or USD 14.99/month without a trial</span>
            </p>
            <div className="button-row">
              <Link className="button button-primary" href="/sign-up">
                Create an account
              </Link>
              <Link className="button button-secondary" href="/check">
                Try a free Check
              </Link>
              <Link className="button button-secondary" href="/sign-in">
                Already a member? Sign in
              </Link>
            </div>
            <p className="help">
              Creating an account does not start a trial or charge you. If annual billing is
              available, a trial starts only after you review the exact first-charge date and
              confirm secure checkout. Seven days are free, then Family renews at USD 149.90 per
              year unless canceled before the trial ends.
            </p>
            <p className="help">
              Private by design: BoomerBuddy does not monitor your phone, read your messages, or
              contact family automatically. A Check explains warning signs and safer actions; it
              cannot guarantee that something is safe.
            </p>
            <p className="help">
              Web access is the current path. iPhone and Android apps are still in signed-device and
              store testing.
            </p>
          </div>
          <aside className="hero-card workflow-card" aria-label="The Family response plan">
            <span className="data-pill">Why families need a plan</span>
            <h2>Fraud can turn one pressured moment into a life-changing loss.</h2>
            <p>
              In 2025, people age 60 and older filed <strong>201,266</strong> complaints with the
              FBI&apos;s Internet Crime Complaint Center and reported{' '}
              <strong>$7.748 billion</strong>
              in losses. More than 12,000 complainants reported losing over $100,000.
            </p>
            <p className="help">
              These are reported complaints and losses, not an estimate of every incident. Source:{' '}
              <a
                href="https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf"
                rel="noreferrer"
                target="_blank"
              >
                FBI 2025 IC3 Annual Report
              </a>
              .
            </p>
            <h3>A simple habit when something feels wrong</h3>
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
                <span>
                  Contact your chosen person, then share a summary with the original message or link
                  removed.
                </span>
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
                  Read dated, source-linked US guidance. Reviewed state-specific briefs currently
                  cover Arizona, California, Illinois, New York, and Pennsylvania; other states use
                  an honest national fallback.
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
                <p className="plan-kicker">Available on the web</p>
                <h3>Family</h3>
                <p className="plan-price">7 days free, then USD 149.90/year</p>
                <ul className="plain-list">
                  <li>Save USD 29.98 compared with twelve monthly payments</li>
                  <li>USD 14.99 monthly is available without a trial</li>
                  <li>Up to three protected adults, with every adult joining by choice</li>
                  <li>Up to six Trusted Circle participants across the household</li>
                  <li>Private History for up to 30 days and sharing only by choice</li>
                  <li>See when your chosen person acknowledges a shared summary</li>
                  <li>Safe Word, seven lessons, guidance, and weekly practice</li>
                </ul>
                <Link className="button button-primary" href="/pricing">
                  Review Family pricing
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
              Create an account to review availability and the exact billing terms. Signing up alone
              does not start a trial or charge you. Native iPhone and Android packages are still
              completing signed-device and store testing.
            </p>
          </div>
          <div className="button-row">
            <Link className="button button-primary" href="/sign-up">
              Create an account
            </Link>
            <Link className="button button-secondary" href="/sign-in">
              Already a member? Sign in
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
