import Link from 'next/link';

export default async function MemberFeedbackPage() {
  const form = await import('../../../components/feedback-form').then(({ FeedbackForm }) => (
    <FeedbackForm mode="authenticated" />
  ));
  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Household feedback</span>
      <h1 className="member-heading">Share a product observation.</h1>
      <p className="lede">
        This form records feedback for the selected household without automatically linking a Check,
        orientation, subscription, support case, or campaign.
      </p>
      {form}
      <p className="meta" style={{ marginTop: '1rem' }}>
        <Link href="/member">Return to member home</Link>
      </p>
    </main>
  );
}
