'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReverification } from '@clerk/nextjs';
import {
  stripeCheckoutResponseSchema,
  stripePortalResponseSchema,
  type ErrorEnvelope,
  type StripeBillingStatusResponse,
} from '@boomerbuddy/contracts';
import { useHousehold } from '../../../components/household-context';
import { ApiError, apiBaseUrl, apiRequest, readableError } from '../../../lib/api';

type Billing = StripeBillingStatusResponse['billing'];
type BillingMutationRequest = (path: string, init: RequestInit) => Promise<unknown>;

interface ClerkReverificationHint {
  readonly clerk_error: {
    readonly type: 'forbidden';
    readonly reason: 'reverification-error';
  };
}

const stateCopy: Readonly<Record<Billing['checkoutState'], string>> = {
  unavailable: 'Online billing is not available for this household yet.',
  eligible_disabled: 'Online payment is temporarily unavailable. No charge has been started.',
  ready: 'Family billing is ready for this household.',
  pending_provider: 'We are confirming the billing request. Please wait before trying again.',
  awaiting_payment_evidence:
    'We are confirming payment before activating the household membership.',
  active: 'The household membership is active from a verified payment.',
  restricted: 'Membership access is temporarily restricted while billing is reviewed.',
};

const stateTitle: Readonly<Record<Billing['checkoutState'], string>> = {
  unavailable: 'Billing is not available',
  eligible_disabled: 'Payment is temporarily unavailable',
  ready: 'Ready for secure checkout',
  pending_provider: 'Confirming your billing request',
  awaiting_payment_evidence: 'Confirming your payment',
  active: 'Membership is active',
  restricted: 'Billing review needed',
};

const recoveryCopy: Readonly<Record<NonNullable<Billing['recoveryReason']>, string>> = {
  payment_action_required:
    'Your payment provider says additional payment confirmation is required.',
  payment_failed: 'Your payment provider could not complete the latest payment attempt.',
  invoice_finalization_failed:
    'Billing setup needs attention before payment can be confirmed. BoomerBuddy is not claiming that a charge, invoice, or receipt exists.',
};

function operationId(prefix: 'checkout' | 'portal'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function checkoutStorageKey(householdId: string): string {
  return `bb:billing:checkout-operation:${householdId}`;
}

function isClerkReverificationHint(value: unknown): value is ClerkReverificationHint {
  if (typeof value !== 'object' || value === null || !('clerk_error' in value)) return false;
  const clerkError = (value as { clerk_error?: unknown }).clerk_error;
  return (
    typeof clerkError === 'object' &&
    clerkError !== null &&
    (clerkError as { type?: unknown }).type === 'forbidden' &&
    (clerkError as { reason?: unknown }).reason === 'reverification-error'
  );
}

async function productionBillingMutation(path: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(
        'The billing service returned an invalid response.',
        'request_failed',
        502,
      );
    }
    if (!response.ok && !isClerkReverificationHint(body)) {
      const envelope = body as Partial<ErrorEnvelope>;
      throw new ApiError(
        envelope.error?.message ?? 'The billing service could not complete that request.',
        envelope.error?.code ?? 'request_failed',
        response.status,
      );
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError('The billing service did not respond in time.', 'request_timeout', 408);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function ProductionBillingPage() {
  const reverifiedMutation = useReverification(productionBillingMutation);
  const mutationRequest = useCallback<BillingMutationRequest>(
    async (path, init) => {
      const result = await reverifiedMutation(path, init);
      if (isClerkReverificationHint(result)) {
        throw new ApiError(
          'A recent enrolled MFA second factor is required for billing. Google or email sign-in and Device Trust alone do not qualify. Set up MFA through secure sign-in, then try again.',
          'billing_mfa_required',
          403,
        );
      }
      return result;
    },
    [reverifiedMutation],
  );
  return <BillingPageContent mutationRequest={mutationRequest} />;
}

function DevelopmentBillingPage() {
  const mutationRequest = useCallback<BillingMutationRequest>(
    (path, init) => apiRequest<unknown>(path, init),
    [],
  );
  return <BillingPageContent mutationRequest={mutationRequest} />;
}

function BillingPageContent({ mutationRequest }: { mutationRequest: BillingMutationRequest }) {
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
      const response = stripeCheckoutResponseSchema.parse(
        await mutationRequest('/v1/commerce/stripe/checkout', {
          method: 'POST',
          headers: {
            'Idempotency-Key': checkoutOperation.current,
            'X-BB-Household-Id': selectedHouseholdId,
          },
          body: JSON.stringify({ offerId: 'founding_family_monthly_v1' }),
        }),
      );
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
      const response = stripePortalResponseSchema.parse(
        await mutationRequest('/v1/commerce/stripe/portal', {
          method: 'POST',
          headers: {
            'Idempotency-Key': portalOperation.current,
            'X-BB-Household-Id': selectedHouseholdId,
          },
        }),
      );
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
        <p>
          <Link href="/member">Return to member home</Link> or{' '}
          <Link href="/support">contact support</Link> for billing help.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Family billing</span>
      <h1 className="member-heading">Manage billing</h1>
      <p className="lede">
        Family is $14.99 USD per month for one household, charged automatically each month until
        canceled. Any applicable taxes and available payment methods are shown in secure checkout.
      </p>
      <p className="meta">
        Before Checkout or billing management opens, BoomerBuddy asks you to confirm your identity
        with an MFA method already enrolled on your account. Google or email sign-in and a trusted
        device do not replace that step. If no MFA method is available, use{' '}
        <Link href="/sign-in">secure sign-in</Link> to complete setup.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="card" aria-live="polite">
        <span className="dev-pill">Subscription status</span>
        <h2>{billing ? stateTitle[billing.checkoutState] : 'Loading billing status…'}</h2>
        <p>{billing ? stateCopy[billing.checkoutState] : 'Checking the selected household.'}</p>
        <p className="meta">
          {notice ||
            'Your membership becomes active only after BoomerBuddy confirms a successful payment.'}
        </p>
        {billing?.pendingOperation ? (
          <p className="meta" data-testid="billing-pending-operation">
            Your billing request is being confirmed. Please wait before starting another request.
            {billing.pendingOperation.nextRetryAt
              ? ` The next automatic check is expected after ${new Date(
                  billing.pendingOperation.nextRetryAt,
                ).toLocaleString()}.`
              : ''}
          </p>
        ) : null}
        {billing?.recoveryReason ? (
          <p className="notice" data-testid="billing-recovery-reason">
            {recoveryCopy[billing.recoveryReason]}{' '}
            {billing.portalAvailable ? (
              <>
                Review secure billing for the next steps currently available. If it does not show a
                recovery option, <Link href="/support">contact support</Link>.
              </>
            ) : (
              <>
                Secure billing is not currently available.{' '}
                <Link href="/support">Contact support</Link> for the next steps currently available.
              </>
            )}
          </p>
        ) : null}
        {billing?.checkoutState === 'ready' && billing.runtimeInitiationEnabled ? (
          <>
            <div className="notice" data-testid="billing-customer-terms">
              <p>
                <strong>Before you continue:</strong> Family costs $14.99 USD and renews every month
                until you cancel.
              </p>
              <p>
                Cancel future renewals through billing management when available or by contacting{' '}
                <Link href="/support">support</Link>. Access ordinarily continues through the paid
                period. Monthly charges are generally not refundable after billing, with exceptions
                explained in the <Link href="/billing-terms">billing terms</Link>.
              </p>
            </div>
            <p className="meta" data-testid="billing-recurring-disclosure">
              By continuing, you authorize a recurring charge of $14.99 USD each month until you
              cancel.
            </p>
            <button
              className="button button-primary"
              type="button"
              disabled={submitting !== undefined}
              onClick={() => void startCheckout()}
            >
              {submitting === 'checkout' ? 'Preparing checkout…' : 'Continue to secure checkout'}
            </button>
          </>
        ) : null}
        {billing?.portalAvailable ? (
          <>
            <button
              className="button button-secondary"
              type="button"
              disabled={submitting !== undefined}
              onClick={() => void openPortal()}
            >
              {submitting === 'portal'
                ? 'Opening portal…'
                : billing.recoveryReason
                  ? 'Review payment in secure billing'
                  : 'View invoices or manage billing'}
            </button>
            <p className="meta" data-testid="billing-invoice-recovery">
              Stripe&apos;s billing portal shows invoice history that Stripe has made available. For
              a missing invoice or payment receipt, <Link href="/support">contact support</Link>;
              BoomerBuddy does not reconstruct unavailable provider records.
            </p>
          </>
        ) : null}
        <button
          className="button button-secondary"
          type="button"
          disabled={submitting !== undefined}
          onClick={() => void refresh()}
        >
          Refresh billing status
        </button>
      </section>
      <nav className="public-nav" aria-label="Billing help" style={{ marginTop: '1rem' }}>
        <Link href="/member">Member home</Link>
        <Link href="/billing-terms">Billing terms</Link>
        <Link href="/support">Support</Link>
      </nav>
    </main>
  );
}

export default function BillingPage() {
  return process.env.NODE_ENV === 'production' ? (
    <ProductionBillingPage />
  ) : (
    <DevelopmentBillingPage />
  );
}
