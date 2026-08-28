'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  FounderProvisioningRegisterResponse,
  FounderProvisioningTransitionRequest,
} from '@boomerbuddy/contracts';
import { apiPaths } from '@boomerbuddy/contracts';

import { hqRequest, readableError } from '../lib/api';

type Draft = {
  readonly workstreamKey: string;
  readonly toStatus: FounderProvisioningTransitionRequest['toStatus'];
  readonly tier: FounderProvisioningTransitionRequest['evidence']['tier'];
  readonly kind: FounderProvisioningTransitionRequest['evidence']['kind'];
  readonly result: FounderProvisioningTransitionRequest['evidence']['result'];
  readonly blockerCode: string;
  readonly manifestDigest: string;
};

const initialDraft: Draft = {
  workstreamKey: 'company_git',
  toStatus: 'founder_in_progress',
  tier: 'founder_report',
  kind: 'setup_started',
  result: 'reported',
  blockerCode: '',
  manifestDigest: '',
};

const statuses = [
  'not_started',
  'founder_in_progress',
  'ready_for_test',
  'test_proven',
  'ready_for_live_review',
  'blocked',
] as const;
const evidenceTiers = [
  'repository_review',
  'founder_report',
  'local_simulation',
  'provider_test',
  'deployed_staging',
  'human_validation',
  'professional_review',
  'live_production',
] as const;
const evidenceKinds = [
  'setup_started',
  'configuration_ready',
  'verification_passed',
  'verification_failed',
  'blocker_recorded',
  'blocker_cleared',
  'configuration_revoked',
  'evidence_invalidated',
  'provider_unavailable',
  'account_removed',
  'live_review_packet_complete',
] as const;
const evidenceResults = ['reported', 'passed', 'failed', 'blocked', 'invalidated'] as const;
const blockerCodes = [
  'founder_account_required',
  'founder_credential_required',
  'founder_cost_decision_required',
  'provider_verification_pending',
  'adapter_not_implemented',
  'legal_review_required',
  'professional_review_required',
  'security_review_required',
  'external_evidence_required',
  'technical_failure',
] as const;

function label(code: string): string {
  return code.replaceAll('_', ' ');
}

function fetchRegister(): Promise<FounderProvisioningRegisterResponse> {
  return hqRequest<FounderProvisioningRegisterResponse>(apiPaths.hqProvisioning);
}

export function FounderProvisioning() {
  const [data, setData] = useState<FounderProvisioningRegisterResponse>();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchRegister()
      .then((response) => {
        if (!active) return;
        setData(response);
        setError('');
      })
      .catch((caught: unknown) => {
        if (active) setError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    return Object.fromEntries(
      statuses.map((status) => [
        status,
        data?.workstreams.filter((workstream) => workstream.status === status).length ?? 0,
      ]),
    );
  }, [data]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const evidence = {
        tier: draft.tier,
        kind: draft.kind,
        result: draft.result,
        ...(draft.blockerCode === ''
          ? {}
          : {
              blockerCode:
                draft.blockerCode as FounderProvisioningTransitionRequest['evidence']['blockerCode'],
            }),
        ...(draft.manifestDigest === '' ? {} : { manifestDigest: draft.manifestDigest }),
        observedAt: new Date().toISOString(),
      };
      const result = await hqRequest<{
        status: string;
        reused: boolean;
        externalActionExecuted: false;
      }>(`${apiPaths.hqProvisioning}/${draft.workstreamKey}/transitions`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `provisioning:${draft.workstreamKey}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ toStatus: draft.toStatus, evidence }),
      });
      setNotice(
        `${label(result.status)} recorded. No adapter, payment, message, deployment, DNS change, purchase, or other external action ran.`,
      );
      setData(await fetchRegister());
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <p role="status">Loading founder provisioning register…</p>;

  return (
    <>
      <div className="control-boundary" role="note">
        <strong>Status is governance evidence, never activation.</strong> This console stores only
        bounded codes, timestamps, and optional SHA-256 digests. It cannot store provider values,
        URLs, notes, credentials, or secrets, and it cannot perform an external action.
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="success-message" role="status">
          {notice}
        </p>
      ) : null}

      {data ? (
        <section className="metric-grid section" aria-label="Provisioning status summary">
          {statuses.map((status) => (
            <article className="metric-card" key={status}>
              <span>{label(status)}</span>
              <strong>{counts[status]}</strong>
              <small>Catalogue v{data.catalogueVersion}</small>
            </article>
          ))}
        </section>
      ) : null}

      {data ? (
        <details className="hq-card action-panel section">
          <summary>Record a bounded status transition</summary>
          <form className="form-grid" onSubmit={submit}>
            <label>
              Workstream
              <select
                value={draft.workstreamKey}
                onChange={(event) => setDraft({ ...draft, workstreamKey: event.target.value })}
              >
                {data.workstreams.map((workstream) => (
                  <option key={workstream.key} value={workstream.key}>
                    {workstream.provider} - {label(workstream.status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New status
              <select
                value={draft.toStatus}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    toStatus: event.target.value as Draft['toStatus'],
                  })
                }
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evidence tier
              <select
                value={draft.tier}
                onChange={(event) =>
                  setDraft({ ...draft, tier: event.target.value as Draft['tier'] })
                }
              >
                {evidenceTiers.map((tier) => (
                  <option key={tier} value={tier}>
                    {label(tier)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evidence kind
              <select
                value={draft.kind}
                onChange={(event) =>
                  setDraft({ ...draft, kind: event.target.value as Draft['kind'] })
                }
              >
                {evidenceKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {label(kind)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evidence result
              <select
                value={draft.result}
                onChange={(event) =>
                  setDraft({ ...draft, result: event.target.value as Draft['result'] })
                }
              >
                {evidenceResults.map((result) => (
                  <option key={result} value={result}>
                    {label(result)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Blocker code (only if blocked/failed)
              <select
                value={draft.blockerCode}
                onChange={(event) => setDraft({ ...draft, blockerCode: event.target.value })}
              >
                <option value="">None</option>
                {blockerCodes.map((code) => (
                  <option key={code} value={code}>
                    {label(code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-span">
              Retained evidence manifest SHA-256 (base64url, 43 characters; never evidence content)
              <input
                value={draft.manifestDigest}
                maxLength={43}
                pattern="[A-Za-z0-9_-]{43}"
                autoComplete="off"
                onChange={(event) => setDraft({ ...draft, manifestDigest: event.target.value })}
              />
            </label>
            <p className="source form-span">
              The server enforces ordered gates, allowed proof tiers, structured blockers,
              invalidation-only downgrades, and exact idempotency. Empty or incompatible evidence
              fails closed.
            </p>
            <button className="primary form-span" type="submit" disabled={busy}>
              {busy ? 'Recording status...' : 'Record status only - run no external action'}
            </button>
          </form>
        </details>
      ) : null}

      <section className="control-grid section" aria-label="Founder provisioning workstreams">
        {(data?.workstreams ?? []).map((workstream) => (
          <article className="hq-card" key={workstream.key}>
            <div className="card-heading-row">
              <div>
                <span className="seed-label">{label(workstream.status)}</span>
                <h2>{workstream.provider}</h2>
              </div>
              <span className="stage-pill">v{workstream.version}</span>
            </div>
            <p>{workstream.purpose}</p>
            <dl className="decision-list">
              <div>
                <dt>Account owner</dt>
                <dd>{workstream.accountOwner}</dd>
              </div>
              <div>
                <dt>MFA / recovery owner</dt>
                <dd>{workstream.recoveryOwner}</dd>
              </div>
              <div>
                <dt>Evidence tier</dt>
                <dd>{label(workstream.latestEvidence.tier)}</dd>
              </div>
              <div>
                <dt>Evidence observation</dt>
                <dd>
                  {label(workstream.latestEvidence.kind)} -{' '}
                  {label(workstream.latestEvidence.result)}
                </dd>
              </div>
              <div>
                <dt>Observed / recorded</dt>
                <dd>
                  {new Date(workstream.latestEvidence.observedAt).toLocaleString()} /{' '}
                  {new Date(workstream.latestEvidence.recordedAt).toLocaleString()}
                </dd>
              </div>
              {workstream.latestEvidence.blockerCode ? (
                <div>
                  <dt>Blocker</dt>
                  <dd>{label(workstream.latestEvidence.blockerCode)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Retained manifest SHA-256</dt>
                <dd>{workstream.latestEvidence.manifestDigest ?? 'None retained'}</dd>
              </div>
              <div>
                <dt>Adapter state</dt>
                <dd>{label(workstream.adapterState)}</dd>
              </div>
              <div>
                <dt>Cost gate</dt>
                <dd>{label(workstream.monthlyCostCeiling)}</dd>
              </div>
              <div>
                <dt>Next founder action</dt>
                <dd>{workstream.nextFounderAction}</dd>
              </div>
            </dl>
            <details className="nested-action-panel">
              <summary>Exact manual steps and names</summary>
              <ol>
                {workstream.manualSteps.map((manualStep) => (
                  <li key={manualStep.code}>
                    {manualStep.instruction}{' '}
                    <span className="source">Before {label(manualStep.requiredBefore)}</span>
                  </li>
                ))}
              </ol>
              <p>
                <strong>Safe identifier names:</strong>{' '}
                {workstream.requiredIdentifierNames.join(', ') || 'None'}
              </p>
              <p>
                <strong>Configuration names:</strong>{' '}
                {workstream.configurationEnvironmentNames.join(', ') || 'None'}
              </p>
              <p>
                <strong>Secret names (values stay in provider secret custody):</strong>{' '}
                {workstream.secretEnvironmentNames.join(', ') || 'None'}
              </p>
              <p>
                <strong>Verification:</strong> {workstream.verificationTest}
              </p>
              <p>
                <strong>Allowed test-proof tiers:</strong>{' '}
                {workstream.allowedProofTiers.map(label).join(', ')}
              </p>
              <p>
                <strong>Export/termination:</strong> {workstream.exportTermination}
              </p>
            </details>
          </article>
        ))}
      </section>
    </>
  );
}
