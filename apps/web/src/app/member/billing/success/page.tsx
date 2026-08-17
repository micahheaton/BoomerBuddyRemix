'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { StripeBillingStatusResponse } from '@boomerbuddy/contracts';
import { useHousehold } from '../../../../components/household-context';
import { apiRequest, readableError } from '../../../../lib/api';

export default function BillingSuccessPage() {
  const { selectedHouseholdId, selectedScope } = useHousehold();
  const [response, setResponse] = useState<StripeBillingStatusResponse>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selectedHouseholdId || selectedScope?.isBillingManager !== true) return;
    void apiRequest<StripeBillingStatusResponse>('/v1/commerce/stripe/billing', {
      headers: { 'X-BB-Household-Id': selectedHouseholdId },
    })
      .then(setResponse)
      .catch((caught) => setError(readableError(caught)));
  }, [selectedHouseholdId, selectedScope?.isBillingManager]);

  const active = response?.billing.canonicalAccessActive === true;
  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Checkout return</span>
      <h1 className="member-heading">
        {active ? 'Verified paid access is active' : 'Payment evidence is still pending'}
      </h1>
      <p className="lede">
        Returning to this page did not grant access. BoomerBuddy reads the canonical server state;
        it does not trust URL parameters or the browser redirect as payment proof.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="card" aria-live="polite">
        <h2>Current server state</h2>
        <p>
          {response
            ? response.billing.checkoutState.replaceAll('_', ' ')
            : 'Checking completed-session and paid-invoice evidence…'}
        </p>
        <p className="meta">
          {response?.evidenceNotice ??
            'Success redirects and provider status snapshots do not grant BoomerBuddy access.'}
        </p>
        <Link className="button button-primary" href="/member/billing">
          Review billing state
        </Link>
      </section>
    </main>
  );
}
