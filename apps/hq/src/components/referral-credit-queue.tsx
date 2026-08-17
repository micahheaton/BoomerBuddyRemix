'use client';

import type { ReferralHqQueueResponse } from '@boomerbuddy/contracts';
import { useCallback, useEffect, useState } from 'react';

import { HqApiError, hqRequest, readableError } from '../lib/api';

export function ReferralCreditQueue() {
  const [data, setData] = useState<ReferralHqQueueResponse>();
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      hqRequest<ReferralHqQueueResponse>('/v1/hq/referrals?limit=100', {
        cache: 'no-store',
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    void load()
      .then((response) => {
        if (!active) return;
        setData(response);
        setError('');
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof HqApiError && (caught.status === 401 || caught.status === 403)) {
          setData(undefined);
        }
        setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, [load]);

  if (error && data === undefined) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (data === undefined) return <p role="status">Loading disabled referral evidence…</p>;

  return (
    <>
      <div className="control-boundary" role="note">
        <strong>Disabled local evidence only.</strong> This queue contains no content, contact,
        recipient identity, or payment identity. No program is active, no credit is promised or
        applied, and no provider or external action can run.
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="section" aria-label="Disabled referral evidence">
        <h2>Referral evidence</h2>
        {data.referrals.length === 0 ? (
          <p>No local referral attribution has been issued.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Attribution state</th>
                  <th>Qualification</th>
                  <th>Balance</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {data.referrals.map((referral) => (
                  <tr key={referral.attributionId}>
                    <td>
                      {referral.programKey} v{referral.programVersion} · {referral.programState}
                    </td>
                    <td>{referral.attributionState.replaceAll('_', ' ')}</td>
                    <td>{referral.qualificationState.replaceAll('_', ' ')}</td>
                    <td>{referral.balanceMinor} minor units</td>
                    <td>{new Date(referral.expiresAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
