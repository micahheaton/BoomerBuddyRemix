'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPaths, type HqSupportReceiptRecordDto } from '@boomerbuddy/contracts';

import { HqApiError, hqRequest, readableError } from '../lib/api';
import { supportReceiptActions, type TransitionAction } from '../lib/support-receipt-ui';

type QueueResponse = {
  readonly projection: 'content_free_support_receipts';
  readonly receipts: HqSupportReceiptRecordDto[];
  readonly truncated: boolean;
  readonly nextOffset: number | null;
  readonly contentIncluded: false;
  readonly outboundMessage: 'not_sent';
  readonly providerAction: 'none';
};
type ResolutionCode = NonNullable<HqSupportReceiptRecordDto['resolutionCode']>;
type TransitionResponse = {
  readonly receipt: HqSupportReceiptRecordDto;
  readonly reused: boolean;
  readonly contentIncluded: false;
  readonly outboundMessage: 'not_sent';
  readonly providerAction: 'none';
};

const pageSize = 20;
const categories: Readonly<Record<HqSupportReceiptRecordDto['category'], string>> = {
  account_access: 'Account access',
  billing: 'Billing',
  check_experience: 'Check experience',
  family_access: 'Family access',
  mobile_app: 'Mobile app',
  privacy: 'Privacy',
  service_availability: 'Service availability',
};
const impacts: Readonly<Record<HqSupportReceiptRecordDto['impact'], string>> = {
  question: 'Question',
  degraded: 'Partly working',
  blocked: 'Blocked',
  safety_concern: 'Safety concern',
};
const states: Readonly<Record<HqSupportReceiptRecordDto['state'], string>> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  in_review: 'In review',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};
const resolutions: readonly { readonly value: ResolutionCode; readonly label: string }[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'duplicate', label: 'Duplicate receipt' },
  {
    value: 'insufficient_content_free_evidence',
    label: 'Insufficient content-free evidence',
  },
  { value: 'outside_supported_scope', label: 'Outside supported scope' },
] as const;

function operationKey(): string {
  return `support-receipt:transition:${crypto.randomUUID()}`;
}

function isDefinitiveMutationFailure(error: unknown): boolean {
  return (
    error instanceof HqApiError && error.status >= 400 && error.status < 500 && error.status !== 408
  );
}

export function SupportReceiptQueue() {
  const [receipts, setReceipts] = useState<HqSupportReceiptRecordDto[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [terminalTruncation, setTerminalTruncation] = useState(false);
  const [resolutionsByReceipt, setResolutionsByReceipt] = useState<
    Readonly<Record<string, ResolutionCode | ''>>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const pendingOperations = useRef(
    new Map<string, { readonly signature: string; readonly operationKey: string }>(),
  );

  const loadPage = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await hqRequest<QueueResponse>(
          `${apiPaths.hqSupportReceipts}?limit=${pageSize}&offset=${offset}`,
          signal === undefined ? {} : { signal },
        );
        setReceipts(response.receipts);
        setNextOffset(response.nextOffset);
        setTerminalTruncation(response.truncated && response.nextOffset === null);
        setUnavailable(false);
        setListError('');
      } catch (caught) {
        if (signal?.aborted) return;
        setReceipts([]);
        setNextOffset(null);
        setTerminalTruncation(false);
        if (caught instanceof HqApiError && caught.status === 404) {
          setUnavailable(true);
          setListError('');
        } else {
          setUnavailable(false);
          setListError(readableError(caught));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [offset],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadPage(controller.signal));
    return () => controller.abort();
  }, [loadPage]);

  function changePage(next: number): void {
    setLoading(true);
    setOffset(next);
  }

  async function transition(
    receipt: HqSupportReceiptRecordDto,
    action: TransitionAction,
  ): Promise<void> {
    const resolutionCode = resolutionsByReceipt[receipt.receiptCode] ?? '';
    if (action === 'resolve' && resolutionCode === '') {
      setActionError(`Choose a fixed resolution for ${receipt.receiptCode} before resolving it.`);
      return;
    }
    const signature = JSON.stringify({
      receiptCode: receipt.receiptCode,
      action,
      ...(action === 'resolve' ? { resolutionCode } : {}),
    });
    const prior = pendingOperations.current.get(receipt.receiptCode);
    const key = prior?.signature === signature ? prior.operationKey : operationKey();
    pendingOperations.current.set(receipt.receiptCode, { signature, operationKey: key });
    setBusy(receipt.receiptCode);
    setActionError('');
    setAnnouncement('');
    try {
      await hqRequest<TransitionResponse>(`${apiPaths.hqSupportReceipts}/transitions`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          receiptCode: receipt.receiptCode,
          action,
          ...(action === 'resolve' ? { resolutionCode } : {}),
        }),
      });
      pendingOperations.current.delete(receipt.receiptCode);
      setAnnouncement(`${receipt.receiptCode} moved through ${action.replaceAll('_', ' ')}.`);
      setLoading(true);
      await loadPage();
    } catch (caught) {
      if (caught instanceof HqApiError && (caught.status === 404 || caught.status === 409)) {
        pendingOperations.current.delete(receipt.receiptCode);
        setLoading(true);
        await loadPage();
        setAnnouncement(
          'That receipt could not be updated. Check the current owner queue before trying again.',
        );
      } else {
        if (isDefinitiveMutationFailure(caught)) {
          pendingOperations.current.delete(receipt.receiptCode);
        }
        setActionError(readableError(caught));
      }
    } finally {
      setBusy('');
    }
  }

  function retryPage(): void {
    setListError('');
    setLoading(true);
    void loadPage();
  }

  return (
    <>
      <section className="notice" aria-labelledby="support-receipt-boundary-heading">
        <h2 id="support-receipt-boundary-heading">Content-free owner queue</h2>
        <p>
          This queue contains only a receipt code, household ID, fixed topic, fixed impact, status,
          and time. It contains no customer name, contact details, message, website address, or
          attachment. A transition sends no email, text message, or provider request.
        </p>
      </section>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {announcement ? <p className="notice">{announcement}</p> : null}
      {actionError ? (
        <p className="error" role="alert">
          {actionError}
        </p>
      ) : null}
      {listError ? (
        <div>
          <p className="error" role="alert">
            {listError}
          </p>
          <button className="secondary" type="button" onClick={retryPage}>
            Try loading the queue again
          </button>
        </div>
      ) : null}
      {loading ? (
        <p role="status">Loading content-free support receipts...</p>
      ) : listError ? null : unavailable ? (
        <section className="notice section" role="status">
          <h2>Support receipt queue unavailable</h2>
          <p>The owner queue remains closed until its server feature flag is enabled.</p>
        </section>
      ) : (
        <div className="table-wrap section">
          <table>
            <caption>Content-free support receipt queue</caption>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Household</th>
                <th>Topic and impact</th>
                <th>Status</th>
                <th>Owner action</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => {
                const actions = supportReceiptActions(receipt.state);
                const canResolve = actions.includes('resolve');
                return (
                  <tr key={receipt.receiptCode}>
                    <td>
                      <strong>{receipt.receiptCode}</strong>
                      <div className="source">
                        Created {new Date(receipt.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td>{receipt.householdId}</td>
                    <td>
                      {categories[receipt.category]}
                      <div className="source">Impact: {impacts[receipt.impact]}</div>
                    </td>
                    <td>{states[receipt.state]}</td>
                    <td>
                      <div className="form-stack">
                        {canResolve ? (
                          <div>
                            <label htmlFor={`support-resolution-${receipt.receiptCode}`}>
                              Fixed resolution
                            </label>
                            <select
                              id={`support-resolution-${receipt.receiptCode}`}
                              value={resolutionsByReceipt[receipt.receiptCode] ?? ''}
                              onChange={(event) =>
                                setResolutionsByReceipt((current) => ({
                                  ...current,
                                  [receipt.receiptCode]: event.target.value as ResolutionCode | '',
                                }))
                              }
                            >
                              <option value="">Choose a resolution</option>
                              {resolutions.map((resolution) => (
                                <option key={resolution.value} value={resolution.value}>
                                  {resolution.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        {actions.map((action) => (
                          <button
                            className={action === 'resolve' ? 'primary' : 'secondary'}
                            key={action}
                            type="button"
                            disabled={
                              busy !== '' ||
                              (action === 'resolve' &&
                                (resolutionsByReceipt[receipt.receiptCode] ?? '') === '')
                            }
                            onClick={() => void transition(receipt, action)}
                          >
                            {busy === receipt.receiptCode
                              ? 'Saving...'
                              : action === 'acknowledge'
                                ? 'Acknowledge'
                                : action === 'start_review'
                                  ? 'Start review'
                                  : 'Resolve'}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {receipts.length === 0 ? (
            <p className="empty">No active support receipts are on this page.</p>
          ) : null}
        </div>
      )}
      {terminalTruncation && !loading && listError === '' ? (
        <p className="notice section" role="status">
          Additional queued receipts are outside this bounded queue view. Use Newer receipts to
          return to earlier pages.
        </p>
      ) : null}
      {!unavailable ? (
        <div className="snapshot-row section" aria-label="Support receipt pages">
          <button
            className="secondary"
            type="button"
            disabled={loading || busy !== '' || offset === 0}
            onClick={() => changePage(Math.max(0, offset - pageSize))}
          >
            Newer receipts
          </button>
          <button
            className="secondary"
            type="button"
            disabled={loading || busy !== '' || nextOffset === null}
            onClick={() => nextOffset !== null && changePage(nextOffset)}
          >
            Older receipts
          </button>
        </div>
      ) : null}
    </>
  );
}
