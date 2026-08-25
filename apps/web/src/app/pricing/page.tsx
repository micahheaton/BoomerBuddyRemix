import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../../components/public-shell';

export default function PricingPage() {
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
              For up to three protected adults and six Trusted Circle people. Household roles,
              protected-adult consent, sharing permissions, and billing authority remain separate.
            </p>
            <p>Payment is available only to invited households with verified billing authority.</p>
          </article>
        </div>
        <div className="notice" style={{ marginTop: '1.5rem' }}>
          <strong>Monthly renewal.</strong> Cancel future renewal through billing management or
          support. Access ordinarily continues through the paid period. Taxes, if applicable, are
          shown before payment. Read the <Link href="/billing-terms">billing terms</Link>.
        </div>
        <div className="button-row">
          <Link className="button button-primary" href="/sign-in">
            Invited member sign in
          </Link>
          <Link className="button button-secondary" href="/support">
            Ask about beta access
          </Link>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
