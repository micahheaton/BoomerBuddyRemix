import Link from 'next/link';

import { MessagingSupport } from '../../components/messaging-support';
import { protectProductionHqResource } from '../../lib/resource-auth';

export default async function MessagingSupportPage() {
  await protectProductionHqResource();
  const localOnlyEnabled = process.env.NODE_ENV !== 'production';
  return (
    <main className="hq-content" id="hq-main">
      <div className="hq-content-inner">
        <div className="hq-title-row">
          <div>
            <span className="seed-label">Local simulation only</span>
            <h1 className="hq-title">Messaging support</h1>
            <p className="subtitle">
              Exact-assignee, content-free intake metadata with separately authorized JIT reads.
              There is no provider callback, reply, or send action.
            </p>
          </div>
          <Link className="hq-button secondary" href="/">
            Owner HQ
          </Link>
        </div>
        {localOnlyEnabled ? (
          <MessagingSupport />
        ) : (
          <div className="control-boundary" role="status">
            Messaging support is not activated. Production requires provider, identity, privacy,
            communications-policy, and founder gates.
          </div>
        )}
      </div>
    </main>
  );
}
