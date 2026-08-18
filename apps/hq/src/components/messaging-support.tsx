'use client';

import type {
  LocalMessagingSupportMetadataResponse,
  LocalMessagingSupportReadResponse,
} from '@boomerbuddy/contracts';
import { useCallback, useEffect, useState } from 'react';

import { HqApiError, hqRequest, readableError } from '../lib/api';

export function MessagingSupport() {
  const [data, setData] = useState<LocalMessagingSupportMetadataResponse>();
  const [selectedEventKey, setSelectedEventKey] = useState('');
  const [grantId, setGrantId] = useState('');
  const [opened, setOpened] = useState<LocalMessagingSupportReadResponse>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      hqRequest<LocalMessagingSupportMetadataResponse>('/v1/hq/messaging/support?limit=50', {
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
          setOpened(undefined);
        }
        setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function readSelected() {
    if (!selectedEventKey || !grantId.trim()) return;
    setBusy(true);
    setError('');
    setOpened(undefined);
    try {
      const response = await hqRequest<LocalMessagingSupportReadResponse>(
        `/v1/hq/messaging/support/${encodeURIComponent(selectedEventKey)}/read`,
        {
          method: 'POST',
          cache: 'no-store',
          body: JSON.stringify({ restrictedAccessGrantId: grantId.trim() }),
        },
      );
      setOpened(response);
    } catch (caught) {
      if (caught instanceof HqApiError && (caught.status === 401 || caught.status === 403)) {
        setOpened(undefined);
      }
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (error && data === undefined) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (data === undefined) return <p role="status">Loading exact-assignee metadata…</p>;

  return (
    <>
      <div className="control-boundary" role="note">
        <strong>Local fixture support only.</strong> This list is content-free and limited to the
        signed-in employee’s exact active cases. Reading minimized text additionally requires the
        exact current step-up grant and records access in the same transaction.
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="section" aria-label="Assigned messaging support fixtures">
        <h2>Assigned support fixtures</h2>
        {data.items.length === 0 ? (
          <p>No active local messaging support fixture is assigned to this employee.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Observed</th>
                  <th>Case</th>
                  <th>State</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.eventKey}>
                    <td>{new Date(item.observedAt).toLocaleString()}</td>
                    <td>{item.supportCaseId}</td>
                    <td>{item.contentState.replaceAll('_', ' ')}</td>
                    <td>
                      <button
                        className="secondary"
                        type="button"
                        disabled={item.contentState !== 'encrypted_minimized'}
                        onClick={() => {
                          setSelectedEventKey(item.eventKey);
                          setOpened(undefined);
                          setError('');
                        }}
                      >
                        Select exact event
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selectedEventKey ? (
        <section className="hq-card section">
          <h2>Step-up read</h2>
          <p>
            Selected event: <code>{selectedEventKey}</code>. Enter only the exact active grant
            issued for this event and case. A grant for another purpose or resource is denied.
          </p>
          <label>
            Restricted-access grant ID
            <input value={grantId} onChange={(event) => setGrantId(event.target.value)} />
          </label>
          <button
            className="primary"
            type="button"
            disabled={busy || !grantId.trim()}
            onClick={() => void readSelected()}
          >
            {busy ? 'Authorizing…' : 'Read assigned minimized text'}
          </button>
          {opened ? (
            <div className="control-boundary" role="status">
              <strong>Exact assigned minimized text</strong>
              <p>{opened.minimizedMessage}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
