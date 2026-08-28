'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  apiPaths,
  supportReceiptCodeSchema,
  type CreateSupportReceiptRequest,
  type SupportReceiptRecordDto,
} from '@boomerbuddy/contracts';

import { ApiError, apiRequest, readableError } from '../lib/api';
import { canWithdrawSupportReceipt } from '../lib/support-receipt-ui';
import { useHousehold } from './household-context';

type Category = CreateSupportReceiptRequest['category'];
type Impact = CreateSupportReceiptRequest['impact'];
type SupportReceiptListResponse = {
  readonly receipts: SupportReceiptRecordDto[];
  readonly truncated: boolean;
  readonly nextOffset: number | null;
  readonly contentIncluded: false;
  readonly outboundMessage: 'not_sent';
  readonly providerAction: 'none';
};
type SupportReceiptMutationResponse = {
  readonly receipt: SupportReceiptRecordDto;
  readonly reused: boolean;
  readonly contentIncluded: false;
  readonly outboundMessage: 'not_sent';
  readonly providerAction: 'none';
};
type PendingCreate = {
  readonly key: string;
  readonly category: Category;
  readonly impact: Impact;
};

const pageSize = 10;
const categories: readonly { readonly value: Category; readonly label: string }[] = [
  { value: 'account_access', label: 'Signing in or account access' },
  { value: 'billing', label: 'Billing or membership payment' },
  { value: 'check_experience', label: 'Checking a message or website' },
  { value: 'family_access', label: 'Family or Trusted Circle access' },
  { value: 'mobile_app', label: 'Mobile app' },
  { value: 'privacy', label: 'Privacy or account deletion' },
  { value: 'service_availability', label: 'Service availability' },
] as const;
const impacts: readonly { readonly value: Impact; readonly label: string }[] = [
  { value: 'question', label: 'I have a question' },
  { value: 'degraded', label: 'Something works only partly' },
  { value: 'blocked', label: 'I cannot continue' },
  { value: 'safety_concern', label: 'I have a safety concern' },
] as const;
const stateLabels: Readonly<Record<SupportReceiptRecordDto['state'], string>> = {
  open: 'Received',
  acknowledged: 'Acknowledged',
  in_review: 'In review',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};
const resolutionLabels = {
  completed: 'Completed',
  duplicate: 'Duplicate receipt',
  insufficient_content_free_evidence: 'Not enough content-free information',
  outside_supported_scope: 'Outside supported scope',
} as const;

function operationKey(kind: 'create' | 'withdraw'): string {
  return `support-receipt:${kind}:${crypto.randomUUID()}`;
}

function supportReceiptEmailDraftHref(receiptCode: string): string {
  const validatedReceiptCode = supportReceiptCodeSchema.parse(receiptCode);
  return `mailto:support@boomerbuddy.net?subject=${encodeURIComponent(validatedReceiptCode)}`;
}

function isDefinitiveMutationFailure(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408
  );
}

export function SupportReceipts() {
  const { selectedHouseholdId } = useHousehold();
  return <HouseholdSupportReceipts key={selectedHouseholdId} />;
}

function HouseholdSupportReceipts() {
  const [category, setCategory] = useState<Category>('account_access');
  const [impact, setImpact] = useState<Impact>('question');
  const [receipts, setReceipts] = useState<SupportReceiptRecordDto[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [terminalTruncation, setTerminalTruncation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [emailReceiptCode, setEmailReceiptCode] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [intakeUnavailable, setIntakeUnavailable] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate>();
  const pendingCreateRef = useRef<PendingCreate | undefined>(undefined);
  const withdrawalKeys = useRef<Record<string, string>>({});

  function clearPendingCreate(): void {
    pendingCreateRef.current = undefined;
    setPendingCreate(undefined);
  }

  const loadPage = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await apiRequest<SupportReceiptListResponse>(
          `${apiPaths.supportReceipts}?limit=${pageSize}&offset=${offset}`,
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
        if (caught instanceof ApiError && caught.status === 404) {
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

  async function refreshFirstPage(): Promise<void> {
    setLoading(true);
    if (offset === 0) await loadPage();
    else setOffset(0);
  }

  function changePage(next: number): void {
    setLoading(true);
    setOffset(next);
  }

  async function createReceipt(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const operation = pendingCreateRef.current ?? {
      key: operationKey('create'),
      category,
      impact,
    };
    pendingCreateRef.current = operation;
    setPendingCreate(operation);
    setBusy('create');
    setActionError('');
    setAnnouncement('');
    try {
      const result = await apiRequest<SupportReceiptMutationResponse>(apiPaths.supportReceipts, {
        method: 'POST',
        headers: { 'Idempotency-Key': operation.key },
        body: JSON.stringify({ category: operation.category, impact: operation.impact }),
      });
      const validatedReceiptCode = supportReceiptCodeSchema.parse(result.receipt.receiptCode);
      clearPendingCreate();
      setEmailReceiptCode(validatedReceiptCode);
      setAnnouncement(
        `Support receipt ${validatedReceiptCode} was recorded. No message or contact details were submitted.`,
      );
      setIntakeUnavailable(false);
      await refreshFirstPage();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        clearPendingCreate();
        setIntakeUnavailable(true);
      } else {
        if (isDefinitiveMutationFailure(caught)) clearPendingCreate();
        setActionError(readableError(caught));
      }
    } finally {
      setBusy('');
    }
  }

  async function withdraw(receiptCode: string): Promise<void> {
    const key = withdrawalKeys.current[receiptCode] ?? operationKey('withdraw');
    withdrawalKeys.current[receiptCode] = key;
    setBusy(receiptCode);
    setActionError('');
    setAnnouncement('');
    try {
      await apiRequest<SupportReceiptMutationResponse>(`${apiPaths.supportReceipts}/withdrawals`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ receiptCode }),
      });
      delete withdrawalKeys.current[receiptCode];
      setAnnouncement(`Support receipt ${receiptCode} was withdrawn.`);
      setLoading(true);
      await loadPage();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 404 || caught.status === 409)) {
        delete withdrawalKeys.current[receiptCode];
        setLoading(true);
        await loadPage();
        setAnnouncement(
          'That receipt could not be withdrawn. Check its current status before trying again.',
        );
      } else {
        if (isDefinitiveMutationFailure(caught)) delete withdrawalKeys.current[receiptCode];
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
    <div className="member-grid" data-testid="member-support-receipts">
      <section className="card" aria-labelledby="support-receipt-create-heading">
        <h2 id="support-receipt-create-heading">Create a private support receipt</h2>
        <p>
          Choose only a topic and how much it affects you. This form has no message box and does not
          collect a name, email address, phone number, website address, or attachment.
        </p>
        {unavailable ? (
          <div className="notice notice-warning" role="status">
            <h3>Support receipts are not available right now</h3>
            <p>
              You can still email{' '}
              <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a>. Do not email
              passwords, verification codes, payment card details, safe words, or the full text of a
              suspicious message.
            </p>
          </div>
        ) : intakeUnavailable ? (
          <div className="notice notice-warning" role="status">
            <h3>Creating a new support receipt is not available right now</h3>
            <p>
              Your existing receipt history may still be available below. You can use the separate
              email option if you need to explain the issue.
            </p>
          </div>
        ) : (
          <form className="form-stack" onSubmit={(event) => void createReceipt(event)}>
            <p className="notice notice-warning">
              Support receipts are not monitored in real time. For immediate danger, contact local
              emergency services.
            </p>
            <div>
              <label htmlFor="support-receipt-category">What do you need help with?</label>
              <select
                id="support-receipt-category"
                disabled={busy !== '' || pendingCreate !== undefined}
                value={category}
                onChange={(event) => setCategory(event.target.value as Category)}
              >
                {categories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="support-receipt-impact">How is this affecting you?</label>
              <select
                id="support-receipt-impact"
                disabled={busy !== '' || pendingCreate !== undefined}
                value={impact}
                onChange={(event) => setImpact(event.target.value as Impact)}
              >
                {impacts.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="help">
              Creating a receipt does not send an email, text message, or provider request. It only
              adds a content-free item to the private support queue.
            </p>
            {pendingCreate && busy === '' ? (
              <p className="help">
                The previous result was uncertain. Retry the same request so BoomerBuddy can recover
                it without creating another receipt.
              </p>
            ) : null}
            <button className="button button-primary" disabled={busy !== ''} type="submit">
              {busy === 'create'
                ? 'Creating receipt...'
                : pendingCreate
                  ? 'Retry same receipt request'
                  : 'Create support receipt'}
            </button>
          </form>
        )}
        {emailReceiptCode !== '' ? (
          <div className="notice">
            <p>
              If you need to explain this issue, you can open an email draft linked to receipt{' '}
              <strong>{emailReceiptCode}</strong>.
            </p>
            <a
              className="button button-secondary"
              href={supportReceiptEmailDraftHref(emailReceiptCode)}
            >
              Open email draft for this receipt
            </a>
            <p className="help">
              The draft subject contains only the receipt code. BoomerBuddy does not prefill the
              email body. Review any automatic signature before sending. No email is sent until you
              choose Send in your email app.
            </p>
          </div>
        ) : null}
        <p className="meta">
          Need to explain the issue? Email{' '}
          <a href="mailto:support@boomerbuddy.net">support@boomerbuddy.net</a>. Sending an email is
          a separate action you control.
        </p>
      </section>

      <section className="card" aria-labelledby="support-receipt-history-heading">
        <h2 id="support-receipt-history-heading">Your support receipts</h2>
        <p>
          These records show only the topic, impact, status, reference code, and time. They never
          show a submitted message or your household identifier.
        </p>
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
            <button className="button button-secondary" type="button" onClick={retryPage}>
              Try loading receipts again
            </button>
          </div>
        ) : null}
        {loading ? (
          <p role="status">Loading support receipts...</p>
        ) : listError ? null : unavailable ? (
          <p className="empty">
            Receipt history is unavailable. The email option remains available.
          </p>
        ) : receipts.length === 0 ? (
          <div className="empty">
            <h3>No support receipts on this page</h3>
            <p>Create one using the topic and impact choices.</p>
          </div>
        ) : (
          <ul className="history-list">
            {receipts.map((receipt) => (
              <li className="history-row" key={receipt.receiptCode}>
                <div>
                  <strong>
                    {categories.find((item) => item.value === receipt.category)?.label}
                  </strong>
                  <p>
                    {impacts.find((item) => item.value === receipt.impact)?.label} |{' '}
                    {stateLabels[receipt.state]}
                  </p>
                  <p className="meta">Reference: {receipt.receiptCode}</p>
                  <p className="meta">Created {new Date(receipt.createdAt).toLocaleString()}</p>
                  {receipt.resolutionCode ? (
                    <p className="meta">Outcome: {resolutionLabels[receipt.resolutionCode]}</p>
                  ) : null}
                </div>
                {canWithdrawSupportReceipt(receipt.state) ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy !== ''}
                    onClick={() => void withdraw(receipt.receiptCode)}
                  >
                    {busy === receipt.receiptCode ? 'Withdrawing...' : 'Withdraw receipt'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {terminalTruncation && !loading && listError === '' ? (
          <p className="notice notice-warning" role="status">
            Additional older receipts are outside this bounded history view. Use Newer receipts to
            return to earlier pages.
          </p>
        ) : null}
        {!unavailable ? (
          <div className="button-row" aria-label="Support receipt pages">
            <button
              className="button button-secondary"
              type="button"
              disabled={loading || busy !== '' || offset === 0}
              onClick={() => changePage(Math.max(0, offset - pageSize))}
            >
              Newer receipts
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={loading || busy !== '' || nextOffset === null}
              onClick={() => nextOffset !== null && changePage(nextOffset)}
            >
              Older receipts
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
