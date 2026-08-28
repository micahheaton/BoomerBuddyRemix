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
          <h1 className="page-title">Family scam-safety support for $14.99 a month</h1>
          <p className="lede">
            One invited household gets short lessons, private Checks and History, and optional help
            from a person each adult chooses. No phone monitoring. No automatic family messages.
          </p>
          <article className="card pricing-offer" aria-labelledby="family-plan-heading">
            <div>
              <span className="data-pill">Available by invitation</span>
              <h2 id="family-plan-heading">Family</h2>
              <p className="plan-price" aria-label="14 dollars and 99 cents US per month">
                $14.99 USD per month
              </p>
              <p>Billed monthly for one invited household. Renews until canceled.</p>
              <div className="button-row pricing-quick-actions">
                <Link className="button button-primary" href="/sign-in">
                  I have an invitation
                </Link>
                <Link className="button button-secondary" href="/check">
                  Try a free Check
                </Link>
              </div>
            </div>
            <div>
              <h3>What is included</h3>
              <ul className="plain-list">
                <li>Seven short safety lessons</li>
                <li>Reviewed, source-linked US scam guidance</li>
                <li>Check suspicious message text or a website address for warning signs</li>
                <li>Private Check History for up to 30 days</li>
                <li>Invite a Trusted Circle person and share a summary only when you choose</li>
                <li>An optional Family Safe Word and weekly in-app practice</li>
              </ul>
            </div>
          </article>
          <div className="notice role-note">
            <strong>Paying does not give anyone access to another adult&apos;s Checks.</strong>{' '}
            Every adult chooses whether to join, use Family features, or share a Check.
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
                  Invite a Trusted Circle person, then share a summary with the original message or
                  link removed when you want their help.
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
            How to get Family
          </h2>
          <p>
            Family is currently available by invitation. If you have an invitation, sign in to see
            whether your account is ready for payment. If not, Public Check remains free while
            access opens to more households.
          </p>
          <div className="button-row">
            <Link className="button button-primary" href="/sign-in">
              I have an invitation
            </Link>
            <Link className="button button-secondary" href="/check">
              Try a free Check
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
                This page has not sent a request or email. Invited members can sign in above. For
                current contact options, visit the <Link href="/support">support page</Link>.
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
                <h3>Can the person paying see another adult&apos;s Checks?</h3>
                <p>
                  No. Each adult joins separately, and each Check stays private unless its owner
                  chooses to share a summary with their Trusted Circle person.
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
