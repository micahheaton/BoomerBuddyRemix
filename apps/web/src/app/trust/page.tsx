import { PublicFooter, PublicHeader } from '../../components/public-shell';

export default function TrustPage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Trust and safety</span>
        <h1 className="page-title">Designed to show its limits</h1>
        <p className="lede">
          A reassuring answer can still be wrong. BoomerBuddy explains what a check noticed, what it
          could not determine, and safer next actions. Signed-in results also show when they were
          created and when they are scheduled for deletion.
        </p>
        <div className="card-grid two" style={{ marginTop: '2rem' }}>
          <article className="card">
            <h2>Minimal records</h2>
            <p>
              Check responses do not repeat submitted content. Public Check keeps a protected
              temporary copy for up to 15 minutes only when needed to let you save after signing in.
              Signed-in records show their deletion time and can be deleted sooner by the owner.
            </p>
          </article>
          <article className="card">
            <h2>Household boundaries</h2>
            <p>
              Each member sees only the household information their role and permissions allow.
              Operations staff can see limited service records needed to support an account, but not
              the message text or website address submitted to Check.
            </p>
          </article>
          <article className="card">
            <h2>Consent you can see</h2>
            <p>
              Trusted Circle permissions are explicit. Invitations are handed directly to the
              intended person and are not sent automatically.
            </p>
          </article>
          <article className="card">
            <h2>No hidden lookups</h2>
            <p>
              The check follows a fixed set of rules. It never opens a website address or checks it
              with an outside service, and its result can be wrong.
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
