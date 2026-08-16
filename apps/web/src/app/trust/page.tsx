import { PublicFooter, PublicHeader } from '../../components/public-shell';

export default function TrustPage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Trust and safety</span>
        <h1 className="page-title">Designed to show its limits</h1>
        <p className="lede">
          A reassuring answer can still be wrong. BoomerBuddy pairs every result with a provider
          state, evidence sufficiency, explicit limitations, and safer next actions.
        </p>
        <div className="card-grid two" style={{ marginTop: '2rem' }}>
          <article className="card">
            <h2>Minimal records</h2>
            <p>
              Check responses do not echo submitted content. Records retain result metadata until
              their displayed deletion time, and you can delete a check sooner.
            </p>
          </article>
          <article className="card">
            <h2>Household boundaries</h2>
            <p>
              Customer access is scoped to a household. HQ sees operational summaries and
              identifiers—not the submitted artifact content.
            </p>
          </article>
          <article className="card">
            <h2>Consent you can see</h2>
            <p>
              Trusted Circle permissions are explicit. Invites in this build are local only and are
              not sent to another person.
            </p>
          </article>
          <article className="card">
            <h2>No hidden live claims</h2>
            <p>
              Analysis uses deterministic local rules. URLs are not fetched, no live reputation
              provider is consulted, and results have not been empirically calibrated.
            </p>
          </article>
        </div>
        <section className="section">
          <h2 className="section-heading">When the stakes are high</h2>
          <p>
            Stop contact. Do not transfer money or disclose credentials. Find the organization’s
            official phone number independently, or ask a trusted person for help. Call emergency
            services if anyone is in immediate danger.
          </p>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
