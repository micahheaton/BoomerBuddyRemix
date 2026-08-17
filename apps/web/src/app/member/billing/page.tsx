'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  StripeBillingStatusResponse,
  StripeCheckoutResponse,
  StripePortalResponse,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { apiRequest, readableError } from '../../../lib/api';

type Billing = StripeBillingStatusResponse['billing'];

const stateCopy: Readonly<Record<Billing['checkoutState'], string>> = {
  unavailable: 'This household is not in the founder-approved billing cohort.',
  eligible_disabled: 'The household is eligible, but payment initiation is disabled.',
  ready: 'The founder-approved test checkout is ready for this billing manager.',
  pending_provider: 'A checkout is pending provider reconciliation. Do not start another one.',
  awaiting_payment_evidence:
    'Checkout returned, but exact paid-invoice evidence has not activated access.',
  active: 'Canonical paid access is active from verified payment evidence.',
  restricted: 'Paid access is restricted while refund or dispute evidence is reconciled.',
};

function operationId(prefix: 'checkout' | 'portal'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function checkoutStorageKey(householdId: string): string {
  return `bb:billing:checkout-operation:${householdId}`;
}

export default function BillingPage() {
  const { selectedHouseholdId, selectedScope } = useHousehold();
  const [billing, setBilling] = useState<Billing>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<'checkout' | 'portal'>();
  const checkoutOperation = useRef<string | undefined>(undefined);
  const portalOperation = useRef<string | undefined>(undefined);

  const retainServerOperation = useCallback(
    (next: Billing) => {
      if (!selectedHouseholdId) return;
      if (next.pendingOperation !== undefined) {
        checkoutOperation.current = next.pendingOperation.serverOperationId;
        window.localStorage.setItem(
          checkoutStorageKey(selectedHouseholdId),
          next.pendingOperation.serverOperationId,
        );
      } else if (next.checkoutState === 'ready') {
        checkoutOperation.current = undefined;
        window.localStorage.removeItem(checkoutStorageKey(selectedHouseholdId));
      }
    },
    [selectedHouseholdId],
  );

  const loadBilling = useCallback(() => {
    if (!selectedHouseholdId || selectedScope?.isBillingManager !== true) return undefined;
    return apiRequest<StripeBillingStatusResponse>('/v1/commerce/stripe/billing', {
      headers: { 'X-BB-Household-Id': selectedHouseholdId },
    });
  }, [selectedHouseholdId, selectedScope?.isBillingManager]);

  const refresh = useCallback(async () => {
    const pending = loadBilling();
    if (pending === undefined) return;
    try {
      const response = await pending;
      setError('');
      setBilling(response.billing);
      retainServerOperation(response.billing);
      setNotice(response.evidenceNotice);
    } catch (caught) {
      setError(readableError(caught));
    }
  }, [loadBilling, retainServerOperation]);

  useEffect(() => {
    const pending = loadBilling();
    if (pending === undefined) return;
    let active = true;
    void pending
      .then((response) => {
        if (!active) return;
        setBilling(response.billing);
        retainServerOperation(response.billing);
        setNotice(response.evidenceNotice);
      })
      .catch((caught: unknown) => {
        if (active) setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, [loadBilling, retainServerOperation]);

  async function startCheckout(): Promise<void> {
    if (billing?.checkoutState !== 'ready' || !selectedHouseholdId) return;
    const storedOperation = selectedHouseholdId
      ? window.localStorage.getItem(checkoutStorageKey(selectedHouseholdId))
      : null;
    checkoutOperation.current ??= storedOperation ?? operationId('checkout');
    if (selectedHouseholdId) {
      window.localStorage.setItem(
        checkoutStorageKey(selectedHouseholdId),
        checkoutOperation.current,
      );
    }
    setSubmitting('checkout');
    setError('');
    try {
      const response = await apiRequest<StripeCheckoutResponse>('/v1/commerce/stripe/checkout', {
        method: 'POST',
        headers: {
          'Idempotency-Key': checkoutOperation.current,
          'X-BB-Household-Id': selectedHouseholdId,
        },
        body: JSON.stringify({ offerId: 'founding_family_monthly_v1' }),
      });
      window.location.assign(response.checkout.url);
    } catch (caught) {
      setError(readableError(caught));
      await refresh();
    } finally {
      setSubmitting(undefined);
    }
  }

  async function openPortal(): Promise<void> {
    if (billing?.portalAvailable !== true || !selectedHouseholdId) return;
    portalOperation.current ??= operationId('portal');
    setSubmitting('portal');
    setError('');
    try {
      const response = await apiRequest<StripePortalResponse>('/v1/commerce/stripe/portal', {
        method: 'POST',
        headers: {
          'Idempotency-Key': portalOperation.current,
          'X-BB-Household-Id': selectedHouseholdId,
        },
      });
      window.location.assign(response.portal.url);
    } catch (caught) {
      setError(readableError(caught));
      await refresh();
    } finally {
      setSubmitting(undefined);
    }
  }

  if (selectedScope?.isBillingManager !== true) {
    return (
      <main id="main-content" className="member-shell member-main">
        <span className="eyebrow">Billing</span>
        <h1 className="member-heading">Billing-manager access required</h1>
        <p className="lede">
          Only the selected household&apos;s active billing manager can view or initiate billing.
        </p>
        <Link href="/member">Return to member home</Link>
      </main>
    );
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Founding Household billing</span>
      <h1 className="member-heading">Manage billing</h1>
      <p className="lede">
        Founding Family monthly is an unvalidated $14.99 USD offer for one household. Promotions,
        automatic tax, adaptive pricing, and non-card payment methods are disabled in this path.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="card" aria-live="polite">
        <span className="dev-pill">Evidence-backed state</span>
        <h2>{billing ? billing.checkoutState.replaceAll('_', ' ') : 'Loading billing state…'}</h2>
        <p>{billing ? stateCopy[billing.checkoutState] : 'Checking the selected household.'}</p>
        <p className="meta">
          {notice ||
            'A provider redirect, success page, or subscription status does not grant access.'}
        </p>
        {billing?.pendingOperation ? (
          <p className="meta" data-testid="billing-pending-operation">
            Same-key reconciliation: {billing.pendingOperation.state.replaceAll('_', ' ')} · attempt{' '}
            {billing.pendingOperation.attemptCount} · reference{' '}
            {billing.pendingOperation.serverOperationId}
            {billing.pendingOperation.nextRetryAt
              ? ` · next check ${new Date(billing.pendingOperation.nextRetryAt).toLocaleString()}`
              : ''}
          </p>
        ) : null}
        {billing?.checkoutState === 'ready' && billing.runtimeInitiationEnabled ? (
          <button
            className="button button-primary"
            type="button"
            disabled={submitting !== undefined}
            onClick={() => void startCheckout()}
          >
            {submitting === 'checkout' ? 'Preparing checkout…' : 'Continue to test checkout'}
          </button>
        ) : null}
        {billing?.portalAvailable ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={submitting !== undefined}
            onClick={() => void openPortal()}
          >
            {submitting === 'portal' ? 'Opening portal…' : 'Open cancel-only billing portal'}
          </button>
        ) : null}
        <button
          className="button button-secondary"
          type="button"
          disabled={submitting !== undefined}
          onClick={() => void refresh()}
        >
          Refresh evidence state
        </button>
      </section>
      <p className="meta" style={{ marginTop: '1rem' }}>
        <Link href="/member">Return to member home</Link>
      </p>
    </main>
  );
}
