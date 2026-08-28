import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../../components/public-shell';
import { indexedCustomerPageMetadata } from '../../lib/public-page-metadata';

export const metadata = indexedCustomerPageMetadata['/pricing'];

export default function PricingPage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <section className="page-shell pricing-hero">
          <span className="eyebrow">Family pricing</span>
          <h1 className="page-title">Choose annual savings or month-to-month Family</h1>
          <p className="lede">
            One household gets seven short lessons, private Checks and History, a Family Safe Word,
            and optional help from a person each adult chooses. No phone monitoring. No automatic
            family messages. Family currently supports up to three protected adults and six Trusted
            Circle participants across the household.
          </p>
          <div className="comparison-grid" aria-label="Family billing choices">
            <article
              className="card plan-card plan-card-featured"
              aria-labelledby="family-annual-heading"
            >
              <p className="plan-kicker">Best annual value</p>
              <h2 id="family-annual-heading">Family annual</h2>
              <p className="plan-price">7 days free, then $149.90 USD per year</p>
              <p>
                The annual price equals ten monthly payments. You save $29.98 compared with paying
                $14.99 for twelve months.
              </p>
              <ul className="plain-list">
                <li>A payment method is required in secure Stripe Checkout</li>
                <li>The exact first-charge date is shown before confirmation</li>
                <li>Cancel before the trial ends to avoid the first annual charge</li>
                <li>Renews yearly until canceled</li>
              </ul>
              <Link className="button button-primary" href="/sign-up">
                Create an account
              </Link>
            </article>
            <article className="card plan-card" aria-labelledby="family-monthly-heading">
              <p className="plan-kicker">No trial</p>
              <h2 id="family-monthly-heading">Family monthly</h2>
              <p className="plan-price">$14.99 USD per month</p>
              <p>Pay month to month when annual billing is not the right fit.</p>
              <ul className="plain-list">
                <li>No free trial</li>
                <li>The first $14.99 payment is due at secure checkout</li>
                <li>Renews monthly until canceled</li>
                <li>The same Family product features are included</li>
              </ul>
              <Link className="button button-secondary" href="/sign-up">
                Create an account
              </Link>
            </article>
          </div>
          <p className="help">
            Creating an account does not start a trial or charge you. If checkout is not yet enabled
            for your account, no payment is attempted and no trial begins.
          </p>
          <div className="button-row pricing-quick-actions">
            <Link className="button button-secondary" href="/check">
              Try a free Check
            </Link>
            <Link className="button button-secondary" href="/sign-in">
              Already a member? Sign in
            </Link>
          </div>
          <div className="notice role-note">
            <strong>Paying does not reveal another adult&apos;s Checks.</strong> Every adult chooses
            whether to join, use Family features, or share a redacted result with one exact Trusted
            Circle person.
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
                  Work through seven short lessons, reviewed source-linked guidance, and an optional
                  weekly practice prompt at your own pace.
                </p>
              </article>
              <article className="card">
                <h3>Check what feels wrong</h3>
                <p>
                  Submit message text or a website address deliberately, then review warning signs,
                  uncertainty, and safer next actions. A Check cannot prove something is safe.
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
              <article className="card">
                <h3>Use a Family Safe Word</h3>
                <p>
                  Agree on an optional private phrase for family-emergency conversations. It is a
                  social aid, not proof of identity.
                </p>
              </article>
              <article className="card">
                <h3>Keep each adult in control</h3>
                <p>
                  Household administration, payment, protected-member consent, and Trusted Circle
                  permission remain separate decisions.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="page-shell pricing-access" aria-labelledby="family-access-heading">
          <h2 id="family-access-heading" className="section-heading">
            How web access starts
          </h2>
          <ol className="workflow-list">
            <li>
              <strong>Create and verify your account</strong>
              <span>Signing up alone is free and does not begin billing.</span>
            </li>
            <li>
              <strong>Review account security and choose a plan</strong>
              <span>
                For billing safety, sign in again and use a second verification method already set
                up on your account before secure checkout can open.
              </span>
            </li>
            <li>
              <strong>Confirm the exact terms in Stripe Checkout</strong>
              <span>
                Annual Checkout shows the seven-day trial, first-charge date, $149.90 amount, and
                renewal before confirmation.
              </span>
            </li>
            <li>
              <strong>Use the full household safety loop</strong>
              <span>Prepare, Check, involve someone by choice, and follow through.</span>
            </li>
          </ol>
          <div className="button-row">
            <Link className="button button-primary" href="/sign-up">
              Create an account
            </Link>
            <Link className="button button-secondary" href="/check">
              Try a free Check
            </Link>
          </div>
          <div className="notice billing-note">
            <strong>Renewal and cancellation.</strong> Family annual is seven days free, then
            $149.90 per year unless canceled before the trial ends. Family monthly is $14.99 from
            checkout and renews monthly. Cancel future renewal through billing management or
            support. Access ordinarily continues through a paid period. Read the{' '}
            <Link href="/billing-terms">billing terms</Link>.
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
