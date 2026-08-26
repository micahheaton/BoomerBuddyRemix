import Link from 'next/link';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function FeedbackPage() {
  await protectProductionHqResource();
  if (process.env.NODE_ENV !== 'production') {
    const { HqScreen } = await import('../../components/hq-screen');
    return <HqScreen view="feedback" />;
  }

  const { FeedbackLearning } = await import('../../components/feedback-learning');

  return (
    <main className="hq-content" id="hq-main">
      <div className="hq-content-inner">
        <div className="hq-title-row">
          <div>
            <span className="seed-label">Live production evidence</span>
            <h1 className="hq-title">Feedback review</h1>
          </div>
          <Link className="hq-button secondary" href="/">
            Owner HQ
          </Link>
        </div>
        <p className="subtitle">
          Founder-only role-scoped metadata and explicitly claimed minimized text.
        </p>
        <FeedbackLearning />
      </div>
    </main>
  );
}
