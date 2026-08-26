import type { Metadata } from 'next';
import { PublicFooter, PublicHeader } from '../../components/public-shell';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
    nosnippet: true,
  },
};

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
        <span className="eyebrow">Anonymous feedback</span>
        <h1 className="page-title">Tell us what could work better.</h1>
        <p className="lede">
          Share a product observation without attaching an account or household. For account or
          billing help, use the Support page.
        </p>
        {localOnlyEnabled ? (
          form
        ) : (
          <section className="notice notice-warning" role="status">
            <h2>Feedback is temporarily unavailable</h2>
            <p>
              Please use the Support page if you need help. Do not send sensitive information
              through this page.
            </p>
          </section>
        )}
      </main>
      <PublicFooter />
    </>
  );
}
