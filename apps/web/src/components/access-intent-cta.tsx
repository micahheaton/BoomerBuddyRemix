'use client';

import { useEffect, useRef, useState } from 'react';
import type { AccessIntentAttribution, CreateAccessIntentResponse } from '@boomerbuddy/contracts';
import { apiRequest, readableError } from '../lib/api';
import { accessIntentAttributionFromSearch, accessIntentMailto } from '../lib/access-intent';

export function AccessIntentCta() {
  const [attribution, setAttribution] = useState<AccessIntentAttribution | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [mailto, setMailto] = useState('');
  const [status, setStatus] = useState('');
  const pendingOperationKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    const captured = accessIntentAttributionFromSearch(window.location.search);
    const frame = window.requestAnimationFrame(() => setAttribution(captured));
    if (window.location.search.length > 0 || window.location.hash.length > 0) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function continueWithoutAttribution() {
    pendingOperationKey.current = undefined;
    setAttribution({ source: 'direct', campaign: 'none' });
    setStatus('Unrecognized attribution was removed. You can create a direct access receipt.');
  }

  async function createReceiptAndOpenEmail() {
    if (attribution === undefined || attribution === null || busy || mailto !== '') return;
    setBusy(true);
    setStatus('');
    try {
      pendingOperationKey.current ??= `access-intent:${crypto.randomUUID()}`;
      const response = await apiRequest<CreateAccessIntentResponse>('/v1/public/access-intents', {
        method: 'POST',
        headers: { 'Idempotency-Key': pendingOperationKey.current },
        body: JSON.stringify({
          purpose: 'private_beta_access_request',
          attribution,
        }),
      });
      const emailDestination = accessIntentMailto(response.intent.receiptCode);
      setStatus(
        `Receipt ${response.intent.receiptCode} was created. No email has been sent; choose Send in your email app to contact support.`,
      );
      setMailto(emailDestination);
      pendingOperationKey.current = undefined;
      window.location.assign(emailDestination);
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="beta-access-heading">
      <h2 id="beta-access-heading">Ask about private-beta access</h2>
      <p>
        First, BoomerBuddy creates a temporary, content-free receipt using only a fixed source and
        campaign label. Then your device opens its own email composer addressed to support. The
        receipt means access intent was created; it does not mean an email was sent or a lead was
        received.
      </p>
      <p className="help">
        BoomerBuddy does not attach an account, name, email address, phone number, or message to the
        receipt. Your contact details reach support only if you choose Send in your email app.
      </p>
      {attribution === null ? (
        <div className="error" role="alert">
          <p>This access link has an unrecognized source or campaign. No receipt was created.</p>
          <button className="button-secondary" type="button" onClick={continueWithoutAttribution}>
            Continue without attribution
          </button>
        </div>
      ) : null}
      <button
        className="button-secondary"
        type="button"
        disabled={attribution === undefined || attribution === null || busy || mailto !== ''}
        onClick={() => void createReceiptAndOpenEmail()}
      >
        {busy
          ? 'Creating receipt...'
          : mailto === ''
            ? 'Create receipt and open email'
            : 'Receipt created'}
      </button>
      {status ? (
        <p className="help" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
      {mailto !== '' ? (
        <p>
          <a href={mailto}>Open the same email draft again</a> without creating another receipt.
        </p>
      ) : null}
    </section>
  );
}
