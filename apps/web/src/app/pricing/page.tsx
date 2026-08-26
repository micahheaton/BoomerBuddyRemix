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
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Pricing</span>
        <h1 className="page-title">One plan for invited early access</h1>
        <p className="lede">
          Family is USD 14.99 per month. It renews monthly until canceled and is available to
          invited households with verified billing authority.
        </p>
        <div className="card-grid" style={{ marginTop: '2rem' }}>
          <article className="card">
            <span className="data-pill">Invitation required</span>
            <h2>Family</h2>
            <p>
              <strong>USD 14.99 monthly</strong>
            </p>
            <p>
              For one invited household. You cannot create a new Trusted Circle invitation right
              now. Household roles, protected-adult consent, sharing permissions, and billing
              authority remain separate.
            </p>
            <p>Payment is available only to invited households with verified billing authority.</p>
          </article>
        </div>
        <section className="section" aria-labelledby="family-includes-heading">
          <h2 id="family-includes-heading">What Family is designed to support</h2>
          <div className="card-grid two">
            <article className="card">
              <h3>One household, clear roles</h3>
              <p>
                Household administration, protected-member consent, sharing permissions, and billing
                authority stay separate so each decision remains visible.
              </p>
            </article>
            <article className="card">
              <h3>Checks you can revisit</h3>
              <p>
                Eligible members can use Check and History within the permissions of their invited
                household role. Results can be wrong and should be verified independently.
              </p>
            </article>
          </div>
        </section>
        <div className="notice" style={{ marginTop: '1.5rem' }}>
          <strong>Monthly renewal.</strong> Cancel future renewal through billing management or
          support. Access ordinarily continues through the paid period. Taxes, if applicable, are
          shown before payment. Read the <Link href="/billing-terms">billing terms</Link>.
        </div>
        <div className="button-row" style={{ marginBottom: '1.5rem' }}>
          <Link className="button button-primary" href="/sign-in">
            Invited member sign in
          </Link>
        </div>
        {accessIntentsEnabled ? (
          <AccessIntentCta />
        ) : (
          <section className="card" aria-labelledby="early-access-unavailable-heading">
            <h2 id="early-access-unavailable-heading">Early-access requests are paused</h2>
            <p>
              Receipt creation is not available from this page right now, and no request or email
              has been sent. Invited members can sign in above. For current contact options, visit
              the <Link href="/support">support page</Link>.
            </p>
          </section>
        )}
        <section className="section" aria-labelledby="family-questions-heading">
          <h2 id="family-questions-heading">Family questions</h2>
          <div className="card-grid">
            <article className="card">
              <h3>Can anyone start a subscription?</h3>
              <p>
                No. Checkout is not public. It is available only after an invited household has
                verified billing authority and the service shows that billing is ready.
              </p>
            </article>
            <article className="card">
              <h3>Does signing in activate access?</h3>
              <p>
                No. Signing in identifies an invited member. Household invitation, consent,
                permissions, billing authority, and paid access are checked separately.
              </p>
            </article>
            <article className="card">
              <h3>What happens after cancellation?</h3>
              <p>
                Cancellation stops a future renewal. Access ordinarily continues through the paid
                period. The billing terms explain timing, refunds, and support options.
              </p>
            </article>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
