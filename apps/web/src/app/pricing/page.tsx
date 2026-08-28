import Link from 'next/link';
import { AccessIntentCta } from '../../components/access-intent-cta';
import { PublicFooter, PublicHeader } from '../../components/public-shell';
import { indexedCustomerPageMetadata } from '../../lib/public-page-metadata';

export const dynamic = 'force-dynamic';
export const metadata = indexedCustomerPageMetadata['/pricing'];

export function privateBetaAccessIntentsEnabled(): boolean {
  return (
    process.env.BB_PRIVATE_BETA_ACCESS_INTENTS_ENABLED === 'true' &&
    process.env.BB_PRIVATE_BETA_ACCESS_INTENTS_EDGE_GUARD_CONFIRMED === 'true'
  );
}

export default function PricingPage() {
  const accessIntentsEnabled = privateBetaAccessIntentsEnabled();
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <section className="page-shell pricing-hero">
          <span className="eyebrow">Family pricing</span>
          <h1 className="page-title">An ongoing household plan for calmer scam response</h1>
          <p className="lede">
            Family combines preparation, private Check history for up to 30 days, and consent-based
            help from a person each adult chooses. Paying never grants access to another
            adult&apos;s Checks.
          </p>
          <article className="card pricing-offer" aria-labelledby="family-plan-heading">
            <div>
              <span className="data-pill">Invitation required</span>
              <h2 id="family-plan-heading">Family</h2>
              <p className="plan-price">USD 14.99 monthly</p>
              <p>For one invited household. It renews monthly until canceled.</p>
            </div>
            <div>
              <h3>What is included</h3>
              <ul className="plain-list">
                <li>Public and member Check, plus private History for up to 30 days</li>
                <li>Consent-based Trusted Circle invitations, sharing, and acknowledgement</li>
                <li>An optional Family Safe Word</li>
                <li>Seven short safety lessons</li>
                <li>Dated, source-linked US guidance, including a reviewed California brief</li>
                <li>An optional weekly practice prompt in the in-app learning feed</li>
              </ul>
            </div>
          </article>
          <div className="notice role-note">
            <strong>Each adult chooses their own participation.</strong> An adult must separately
            enroll for Family protection features before using private Check, History, learning,
            Safe Word, or Trusted Circle sharing. Paying for or organizing a household does not
            activate those features for another adult.
          </div>
        </section>

        <section className="section section-alt">
          <div className="page-shell section-shell">
            <div className="section-copy">
              <h2 className="section-heading">A plan before, during, and after uncertainty</h2>
              <p className="section-lede">
                Family supports a repeatable safety habit without turning care into surveillance.
              </p>
            </div>
            <div className="card-grid value-grid">
              <article className="card">
                <h3>Prepare before pressure</h3>
                <p>
                  Work through short lessons, reviewed guidance, and a weekly practice prompt at
                  your own pace.
                </p>
              </article>
              <article className="card">
                <h3>Choose private help</h3>
                <p>
                  Invite one exact Trusted Circle person, then deliberately share a redacted result
                  when you want their help.
                </p>
              </article>
              <article className="card">
                <h3>Follow through</h3>
                <p>
                  The chosen person can acknowledge review in the app. The owner can record that a
                  concern was handled; this is self-reported, not independently verified.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="page-shell pricing-access" aria-labelledby="family-access-heading">
          <h2 id="family-access-heading" className="section-heading">
            Family access
          </h2>
          <p>
            Checkout is not public. It becomes available only after an invited household has
            verified billing authority and the service shows that billing is ready.
          </p>
          <div className="button-row">
            <Link className="button button-primary" href="/sign-in">
              Invited member sign in
            </Link>
            <Link className="button button-secondary" href="/check">
              Try Public Check free
            </Link>
          </div>
          {accessIntentsEnabled ? (
            <AccessIntentCta />
          ) : (
            <section
              className="card access-state"
              aria-labelledby="early-access-unavailable-heading"
            >
              <h3 id="early-access-unavailable-heading">Family access requests are paused</h3>
              <p>
                No request or email has been sent from this page. Invited members can sign in above.
                For current contact options, visit the <Link href="/support">support page</Link>.
              </p>
            </section>
          )}
          <div className="notice billing-note">
            <strong>Monthly renewal.</strong> Cancel future renewal through billing management or
            support. Access ordinarily continues through the paid period. Taxes, if applicable, are
            shown before payment. Read the <Link href="/billing-terms">billing terms</Link>.
          </div>
        </section>

        <section className="section section-alt" aria-labelledby="family-questions-heading">
          <div className="page-shell section-shell">
            <h2 id="family-questions-heading" className="section-heading">
              Family questions
            </h2>
            <div className="card-grid value-grid">
              <article className="card">
                <h3>Can family members read my messages?</h3>
                <p>
                  No. BoomerBuddy examines only something you deliberately submit. Each Check is
                  private by default, and only a redacted result is shared when its owner chooses.
                </p>
              </article>
              <article className="card">
                <h3>Does paying activate access or visibility?</h3>
                <p>
                  No. Sign-in, household invitation, adult consent, exact sharing permission,
                  billing authority, and paid access are checked separately.
                </p>
              </article>
              <article className="card">
                <h3>Will BoomerBuddy contact my family?</h3>
                <p>
                  Not automatically. Trusted Circle acknowledgement is currently in-app. During
                  early access, the member contacts their chosen person directly.
                </p>
              </article>
              <article className="card">
                <h3>Does a Check prove something is safe?</h3>
                <p>
                  No. Results can be wrong. BoomerBuddy explains warning signs, unknowns, and safer
                  next actions so you can verify independently.
                </p>
              </article>
              <article className="card">
                <h3>What happens after cancellation?</h3>
                <p>
                  Cancellation stops a future renewal. Access ordinarily continues through the paid
                  period. The billing terms explain timing, refunds, and support options.
                </p>
              </article>
              <article className="card">
                <h3>Can I get the mobile app now?</h3>
                <p>
                  Web access is the current controlled path. Native iPhone and Android packages are
                  still completing signed-device and store testing.
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
