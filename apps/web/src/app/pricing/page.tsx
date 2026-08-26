import Link from 'next/link';
import { AccessIntentCta } from '../../components/access-intent-cta';
import { PublicFooter, PublicHeader } from '../../components/public-shell';

export const dynamic = 'force-dynamic';

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
        <h1 className="page-title">One plan for the private beta</h1>
        <p className="lede">
          Family is USD 14.99 per month. It renews monthly until canceled and is available to
          invited households with verified billing authority.
        </p>
        <div className="card-grid" style={{ marginTop: '2rem' }}>
          <article className="card">
            <span className="data-pill">Private beta</span>
            <h2>Family</h2>
            <p>
              <strong>USD 14.99 monthly</strong>
            </p>
            <p>
              For one invited household. New Trusted Circle invitations are not self-service during
              this private beta. Household roles, protected-adult consent, sharing permissions, and
              billing authority remain separate.
            </p>
            <p>Payment is available only to invited households with verified billing authority.</p>
          </article>
        </div>
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
          <section className="card" aria-labelledby="beta-access-unavailable-heading">
            <h2 id="beta-access-unavailable-heading">Private-beta access requests are paused</h2>
            <p>
              Receipt creation is not available from this page right now, and no request or email
              has been sent. Invited members can sign in above. For current contact options, visit
              the <Link href="/support">support page</Link>.
            </p>
          </section>
        )}
      </main>
      <PublicFooter />
    </>
  );
}
