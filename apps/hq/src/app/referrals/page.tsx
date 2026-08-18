import Link from 'next/link';

import { ReferralCreditQueue } from '../../components/referral-credit-queue';

export default function ReferralsPage() {
  const localOnlyEnabled = process.env.NODE_ENV !== 'production';
  return (
    <main className="hq-content" id="hq-main">
      <div className="hq-content-inner">
        <div className="hq-title-row">
          <div>
            <span className="seed-label">Local simulation only</span>
            <h1 className="hq-title">Referral credit evidence</h1>
            <p className="subtitle">
              Content-free evidence for a disabled credit engine. This route cannot issue an
              invitation, promise or apply credit, contact a recipient, or execute a provider
              action.
            </p>
          </div>
          <Link className="hq-button secondary" href="/">
            Owner HQ
          </Link>
        </div>
        {localOnlyEnabled ? (
          <ReferralCreditQueue />
        ) : (
          <div className="control-boundary" role="status">
            <strong>Referral credits are not activated.</strong> Production access remains blocked
            until terms, economics, provider application, reconciliation, platform, and founder
            gates are independently satisfied.
          </div>
        )}
      </div>
    </main>
  );
}
