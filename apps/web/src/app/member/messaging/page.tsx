'use client';

import type {
  LocalMessagingConsentResponse,
  LocalMessagingDestinationResponse,
  LocalMessagingStatusResponse,
  MessagingPurposeDto,
} from '@boomerbuddy/contracts';
import Link from 'next/link';
import { useState } from 'react';

import { apiRequest, readableError } from '../../../lib/api';

const purposes: readonly { readonly key: MessagingPurposeDto; readonly label: string }[] = [
  { key: 'customer_care', label: 'Customer care' },
  { key: 'account_service', label: 'Account and service notices' },
  { key: 'fraud_safety', label: 'Fraud-safety reminders' },
];

export default function MessagingPage() {
  const localOnlyEnabled = process.env.NODE_ENV !== 'production';
  const [suffix, setSuffix] = useState('01');
  const [timeZone, setTimeZone] = useState('America/Los_Angeles');
  const [locale, setLocale] = useState('en-US');
  const [destinationId, setDestinationId] = useState('');
  const [status, setStatus] = useState<LocalMessagingStatusResponse>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function registerDestination() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiRequest<LocalMessagingDestinationResponse>(
        '/v1/messaging/local/destinations',
        {
          method: 'POST',
          body: JSON.stringify({
            localFixtureDestination: `+120255501${suffix}`,
            timeZone,
            locale,
            jurisdiction: 'US',
          }),
        },
      );
      setDestinationId(response.destination.id);
      setStatus(response.status);
      setNotice(
        'Synthetic destination recorded locally. No provider was contacted and no message can be sent.',
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function setConsent(purpose: MessagingPurposeDto, action: 'grant' | 'withdraw') {
    if (!destinationId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiRequest<LocalMessagingConsentResponse>(
        `/v1/messaging/local/destinations/${encodeURIComponent(destinationId)}/consents/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({
            purpose,
            disclosureVersion: 'sms-purpose-local-v1',
            policyVersion: 'messaging-local-consent-v1',
          }),
        },
      );
      setStatus(response.status);
      setNotice(
        `${action === 'grant' ? 'Recorded' : 'Withdrew'} local ${purpose.replaceAll('_', ' ')} consent. No provider action occurred.`,
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Messaging</span>
      <h1 className="member-heading">Messaging is not available yet.</h1>
      <p className="lede">
        BoomerBuddy does not currently send invitations, alerts, or other text messages. No contacts
        are uploaded and no message is sent from this page.
      </p>
      {!localOnlyEnabled ? (
        <section className="notice notice-warning" role="status">
          <h2>Messaging is not activated</h2>
          <p>
            Messaging remains unavailable during this private beta. Return to member home to use the
            available account features.
          </p>
          <Link href="/member">Return to member home</Link>
        </section>
      ) : (
        <>
          <section className="card">
            <span className="dev-pill">Reserved synthetic range only</span>
            <h2>Local destination fixture</h2>
            <p>
              The only accepted shape is <code>+1 202-555-01xx</code>. It is encrypted and keyed for
              the signed-in person; responses never return the number.
            </p>
            <label>
              Final two digits
              <input
                aria-label="Synthetic destination final two digits"
                inputMode="numeric"
                maxLength={2}
                pattern="[0-9]{2}"
                value={suffix}
                onChange={(event) => setSuffix(event.target.value.replace(/\D/gu, '').slice(0, 2))}
              />
            </label>
            <label>
              Time zone
              <input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} />
            </label>
            <label>
              Locale
              <input value={locale} onChange={(event) => setLocale(event.target.value)} />
            </label>
            <button
              className="button button-primary"
              type="button"
              disabled={busy || !/^\d{2}$/u.test(suffix) || !timeZone || !locale}
              onClick={() => void registerDestination()}
            >
              {busy ? 'Recording…' : 'Record local fixture'}
            </button>
          </section>
          {status ? (
            <section className="card" aria-label="Messaging purpose choices">
              <h2>Separate purpose choices</h2>
              <p>
                A choice here is append-only local evidence for this synthetic destination. It is
                not transferred from a household member and does not authorize any provider.
              </p>
              {purposes.map(({ key, label }) => {
                const current = status.consents.find((consent) => consent.purpose === key);
                return (
                  <div key={key} className="card">
                    <h3>{label}</h3>
                    <p>
                      State: <strong>{current?.state ?? 'not_granted'}</strong>
                      {current?.suppressed ? ' · suppressed' : ''}
                    </p>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy || current?.state === 'active'}
                      onClick={() => void setConsent(key, 'grant')}
                    >
                      Choose this purpose
                    </button>{' '}
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy || current?.state === 'withdrawn'}
                      onClick={() => void setConsent(key, 'withdraw')}
                    >
                      Withdraw
                    </button>
                  </div>
                );
              })}
            </section>
          ) : null}
        </>
      )}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="meta" style={{ marginTop: '1rem' }}>
        <Link href="/member">Return to member home</Link>
      </p>
    </main>
  );
}
