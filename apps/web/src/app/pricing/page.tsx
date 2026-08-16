import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../../components/public-shell';

export default function PricingPage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Pricing</span>
        <h1 className="page-title">Pricing is still a hypothesis</h1>
        <p className="lede">
          No plan is for sale in this local development build. The figures below are research
          assumptions, not offers or validated willingness-to-pay.
        </p>
        <div className="card-grid" style={{ marginTop: '2rem' }}>
          <article className="card">
            <span className="data-pill">Hypothesis · Not for sale</span>
            <h2>Free</h2>
            <p>
              <strong>$0</strong> proposed entry plan
            </p>
            <p>
              Proposed limited core checks and education. Capability boundaries remain a research
              hypothesis; billing is not implemented.
            </p>
          </article>
          <article className="card">
            <span className="data-pill">Hypothesis · Not for sale</span>
            <h2>Plus</h2>
            <p>
              <strong>$8.99 monthly</strong> or $89 annually
            </p>
            <p>
              Proposed for one protected adult and up to two Trusted Circle people, with deliberate
              redacted-result sharing after pairwise consent. Billing is not implemented.
            </p>
          </article>
          <article className="card">
            <span className="data-pill">Hypothesis · Not for sale</span>
            <h2>Family</h2>
            <p>
              <strong>$14.99 monthly</strong> or $149 annually
            </p>
            <p>
              Proposed for up to three protected adults and six Trusted Circle people, with the same
              deliberate redacted-result sharing and consent boundaries. A separate $119 founding
              Family offer is only a research test. Billing is not implemented.
            </p>
          </article>
        </div>
        <div className="notice notice-warning" style={{ marginTop: '1.5rem' }}>
          <strong>Development access is free.</strong> Seeded personas let you inspect the product
          without entering payment details.
        </div>
        <div className="button-row">
          <Link className="button button-primary" href="/check">
            Use anonymous Public Check
          </Link>
          <Link className="button button-secondary" href="/trust">
            Read the trust model
          </Link>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
