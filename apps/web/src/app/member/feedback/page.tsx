import Link from 'next/link';

export default async function MemberFeedbackPage() {
  const localOnlyEnabled = process.env.NODE_ENV !== 'production';
  const form = localOnlyEnabled
    ? await import('../../../components/feedback-form').then(({ FeedbackForm }) => (
        <FeedbackForm mode="authenticated" />
      ))
    : undefined;
  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Household feedback</span>
      <h1 className="member-heading">Share a product observation.</h1>
      <p className="lede">
        This form records feedback for the selected household without automatically linking a Check,
        orientation, subscription, support case, or campaign.
      </p>
      {localOnlyEnabled ? (
        form
      ) : (
        <section className="notice notice-warning" role="status">
          <h2>Feedback intake is not activated</h2>
          <p>
            The local candidate is unavailable in production until its founder and privacy gates are
            reviewed. Do not send feedback or sensitive information through this page.
          </p>
        </section>
      )}
      <p className="meta" style={{ marginTop: '1rem' }}>
        <Link href="/member">Return to member home</Link>
      </p>
    </main>
  );
}
