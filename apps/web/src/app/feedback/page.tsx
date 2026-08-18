import { PublicFooter, PublicHeader } from '../../components/public-shell';

export default async function AnonymousFeedbackPage() {
  const localOnlyEnabled = process.env.NODE_ENV !== 'production';
  const form = localOnlyEnabled
    ? await import('../../components/feedback-form').then(({ FeedbackForm }) => (
        <FeedbackForm mode="anonymous" />
      ))
    : undefined;
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell">
        <span className="eyebrow">Anonymous local feedback</span>
        <h1 className="page-title">Tell us what could work better.</h1>
        <p className="lede">
          Share a product observation without attaching an account or household. For account or
          billing help, sign in and use the assigned support path instead.
        </p>
        {localOnlyEnabled ? (
          form
        ) : (
          <section className="notice notice-warning" role="status">
            <h2>Feedback intake is not activated</h2>
            <p>
              The local candidate is unavailable in production until its founder and privacy gates
              are reviewed. Do not send feedback or sensitive information through this page.
            </p>
          </section>
        )}
      </main>
      <PublicFooter />
    </>
  );
}
