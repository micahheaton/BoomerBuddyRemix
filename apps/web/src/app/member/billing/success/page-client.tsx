'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { StripeBillingStatusResponse } from '@boomerbuddy/contracts';
import { useHousehold } from '../../../../components/household-context';
import { apiRequest, readableError } from '../../../../lib/api';

type Billing = StripeBillingStatusResponse['billing'];

const stateTitle: Readonly<Record<Billing['checkoutState'], string>> = {
  unavailable: 'Billing is not available',
  eligible_disabled: 'Payment is temporarily unavailable',
  ready: 'Ready for secure checkout',
  pending_provider: 'Confirming your billing request',
  awaiting_payment_evidence: 'Confirming your payment',
  active: 'Membership is active',
  restricted: 'Billing review needed',
};

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
        {active ? 'Your Family membership is active' : 'We are confirming your payment'}
      </h1>
      <p className="lede">
        Returning from Checkout does not by itself activate membership. BoomerBuddy confirms a
        completed payment before turning on paid access.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="card" aria-live="polite">
        <h2>Membership status</h2>
        <p>
          {response ? stateTitle[response.billing.checkoutState] : 'Checking your payment status…'}
        </p>
        <p className="meta">
          {response?.evidenceNotice ??
            'Your membership becomes active only after BoomerBuddy verifies an eligible trial or successful payment.'}
        </p>
        <Link className="button button-primary" href="/member/billing">
          Review billing
        </Link>
      </section>
    </main>
  );
}
