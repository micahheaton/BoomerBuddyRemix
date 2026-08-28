import { PublicFooter, PublicHeader } from '../../components/public-shell';
import { indexedCustomerPageMetadata } from '../../lib/public-page-metadata';

export const metadata = indexedCustomerPageMetadata['/trust'];

export default function TrustPage() {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell trust-page">
        <span className="eyebrow">Trust and safety</span>
        <h1 className="page-title">Help without surveillance</h1>
        <p className="lede">
          BoomerBuddy examines only the text or website address someone deliberately submits. Every
          adult chooses whether to participate and what to share. Paying for Family does not reveal
          another adult&apos;s Checks.
        </p>
        <div className="card-grid two trust-grid">
          <article className="card">
            <h2>No continuous monitoring</h2>
            <p>
              BoomerBuddy does not watch messages, calls, contacts, accounts, or location. It does
              not open the website address someone enters or look it up with an outside service.
            </p>
          </article>
          <article className="card">
            <h2>Private by default</h2>
            <p>
              Submitted text and website addresses are not visible to other household members.
              Household, administrator, and payer status do not create access to a Check. Its owner
              can deliberately share a redacted result with one exact Trusted Circle person.
            </p>
          </article>
          <article className="card">
            <h2>Consent you can change</h2>
            <p>
              Trusted Circle invitations and permissions are explicit and revocable. Invitations are
              handed directly to the intended person and are not sent automatically.
            </p>
          </article>
          <article className="card">
            <h2>Minimal records</h2>
            <p>
              Check responses do not repeat submitted content. Public Check keeps a protected
              temporary copy for up to 15 minutes only when needed to let someone save after signing
              in. Signed-in records show their deletion time and can be deleted sooner by the owner.
            </p>
          </article>
          <article className="card">
            <h2>Limited operations metadata</h2>
            <p>
              Authorized operations staff can see limited service metadata needed to operate and
              support the service, including household, Check type, risk label, processing status,
              and timing. They cannot see the submitted message text or website address.
            </p>
          </article>
        </div>
        <section className="section">
          <h2 className="section-heading">Clear limits when the stakes are high</h2>
          <p>
            A reassuring answer can still be wrong. BoomerBuddy explains warning signs, unknowns,
            and safer next actions, but it does not prove that a message is safe or fraudulent. Stop
            contact when money, accounts, or safety may be at risk. Find the organization&apos;s
            official phone number independently, or ask a trusted person for help. Call emergency
            services if anyone is in immediate danger.
          </p>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
