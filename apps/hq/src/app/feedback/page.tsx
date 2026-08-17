import Link from 'next/link';

export default async function FeedbackPage() {
  if (process.env.NODE_ENV !== 'production') {
    const { HqScreen } = await import('../../components/hq-screen');
    return <HqScreen view="feedback" />;
  }

  return (
    <main className="hq-content" id="hq-main">
      <div className="hq-content-inner">
        <div className="hq-title-row">
          <div>
            <span className="seed-label">Production blocked</span>
            <h1 className="hq-title">Feedback review</h1>
          </div>
          <Link className="hq-button secondary" href="/">
            Owner HQ
          </Link>
        </div>
        <div className="control-boundary" role="status">
          <strong>Feedback review is not activated.</strong> Production access remains blocked until
          identity, privacy, retention, managed-storage, human-review, platform, and founder gates
          are independently satisfied.
        </div>
      </div>
    </main>
  );
}
