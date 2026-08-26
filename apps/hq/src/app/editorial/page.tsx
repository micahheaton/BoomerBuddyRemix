import Link from 'next/link';

import { EditorialIntelligenceBoard } from '../../components/editorial-intelligence';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function EditorialPage() {
  await protectProductionHqResource();
  const localOnlyEnabled = process.env.NODE_ENV !== 'production';
  return (
    <main className="hq-content" id="hq-main">
      <div className="hq-content-inner">
        <div className="hq-title-row">
          <div>
            <span className="seed-label">Local simulation only</span>
            <h1 className="hq-title">Editorial intelligence</h1>
            <p className="subtitle">
              Source health, assigned reviews, internal calendar, corrections, and local preference
              counts. This route cannot fetch, generate, publish, or send.
            </p>
          </div>
          <Link className="hq-button secondary" href="/">
            Owner HQ
          </Link>
        </div>
        {localOnlyEnabled ? (
          <EditorialIntelligenceBoard />
        ) : (
          <div className="control-boundary" role="status">
            <strong>Editorial intelligence is not activated.</strong> Production access remains
            blocked until source, artifact, managed-storage, human-review, correction, platform, and
            founder gates are independently satisfied.
          </div>
        )}
      </div>
    </main>
  );
}
