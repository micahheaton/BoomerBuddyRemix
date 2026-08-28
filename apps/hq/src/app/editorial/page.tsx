import Link from 'next/link';

import { EditorialIntelligenceBoard } from '../../components/editorial-intelligence';
import { GovernedContentStudio } from '../../components/governed-content';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function EditorialPage() {
  await protectProductionHqResource();
  const localOnlyEnabled = process.env.NODE_ENV !== 'production';
  return (
    <main className="hq-content" id="hq-main">
      <div className="hq-content-inner">
        <div className="hq-title-row">
          <div>
            <span className="seed-label">First-party content</span>
            <h1 className="hq-title">Editorial studio</h1>
            <p className="subtitle">
              Draft from approved public facts, preview exact revisions, record independent reviews,
              and explicitly publish to BoomerBuddy Learn.
            </p>
          </div>
          <Link className="hq-button secondary" href="/">
            Owner HQ
          </Link>
        </div>
        <GovernedContentStudio />
        <div className="section">
          <h2>Editorial intelligence boundary</h2>
          {localOnlyEnabled ? (
            <EditorialIntelligenceBoard />
          ) : (
            <div className="control-boundary" role="status">
              <strong>Editorial intelligence is not activated.</strong> Production access remains
              blocked until source, artifact, managed-storage, human-review, correction, platform,
              and founder gates are independently satisfied.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
