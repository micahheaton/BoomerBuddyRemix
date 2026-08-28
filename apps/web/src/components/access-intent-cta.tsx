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
    setStatus('The unrecognized campaign label was removed. You can continue directly.');
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
        `Request reference ${response.intent.receiptCode} is ready. No email has been sent; choose Send in your email app to contact support.`,
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
    <section className="card" aria-labelledby="early-access-heading">
      <h3 id="early-access-heading">Ask about Family early access</h3>
      <p>
        Choose below to create a temporary request reference and open an email draft addressed to
        BoomerBuddy support. No email is sent until you review the draft and press Send in your
        email app.
      </p>
      <p className="help">
        The reference uses only a fixed source and campaign label. It does not attach an account,
        name, email address, phone number, or message. A reference does not mean an email was sent
        or a request was received. Your contact details reach support only if you press Send.
      </p>
      {attribution === null ? (
        <div className="error" role="alert">
          <p>This link has an unrecognized campaign label. Nothing was created or sent.</p>
          <button className="button-secondary" type="button" onClick={continueWithoutAttribution}>
            Continue directly
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
          ? 'Preparing email draft...'
          : mailto === ''
            ? 'Open an email request'
            : 'Email draft ready'}
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
