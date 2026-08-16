'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  CreditUnionTargetsResponse,
  OpportunityQueueResponse,
  OwnerBriefResponse,
} from '@boomerbuddy/contracts';
import { hqRequest, readableError } from '../lib/api';

export type BusinessOsView = 'owner' | 'targets' | 'pipeline' | 'attention' | 'autonomy';

type AttentionItem = {
  id: string;
  attentionKind: string;
  sourceType: string;
  sourceId: string;
  whyFounderRequired: string;
  recommendedAction: string;
  consequenceOfInaction: string;
  deadline?: string;
  state: 'open' | 'snoozed' | 'resolved' | 'dismissed';
  createdAt: string;
  updatedAt: string;
};

type AttentionResponse = { items: AttentionItem[] };
type Opportunity = OpportunityQueueResponse['opportunities'][number];
type OpportunityStage = Opportunity['stage'];
type AutonomyClass = 'auto' | 'approval' | 'human' | 'professional';
type EvaluationResponse = {
  allowed: boolean;
  disposition: AutonomyClass | 'blocked';
  reasons: string[];
  runId: string;
};
type GlobalAutomationControl = {
  killSwitch: boolean;
  updatedAt?: string;
};

const businessOsPaths = {
  ownerBrief: '/v1/hq/business-os/owner-brief',
  creditUnions: '/v1/hq/business-os/credit-unions',
  opportunities: '/v1/hq/business-os/opportunities',
  attention: '/v1/hq/business-os/attention',
  autonomyPolicies: '/v1/hq/business-os/autonomy/policies',
  autonomyEvaluate: '/v1/hq/business-os/autonomy/evaluate',
  autonomyGlobalControl: '/v1/hq/business-os/autonomy/global-control',
} as const;

const opportunityStages: OpportunityStage[] = [
  'target',
  'prospecting',
  'engaged',
  'discovery',
  'qualified',
  'pilot',
  'business_case',
  'contracting',
  'closed_won',
  'closed_lost',
  'implementation',
  'active_partner',
  'expansion',
];

const segmentLabels = {
  under_10k: 'Under 10,000 members',
  '10k_50k': '10,000–49,999 members',
  '50k_250k': '50,000–249,999 members',
  '250k_plus': '250,000+ members',
} as const;

const autonomyLabels: Record<AutonomyClass, string> = {
  auto: 'AUTO — bounded execution',
  approval: 'APPROVAL — owner decision required',
  human: 'HUMAN — assigned person performs the work',
  professional: 'PROFESSIONAL — qualified specialist required',
};

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  maximumFractionDigits: 0,
  style: 'currency',
});

function EvidenceLabel({ children }: { children: string }) {
  return <span className="seed-label">{children}</span>;
}

function LoadingState({ children }: { children: string }) {
  return <p role="status">{children}</p>;
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="error" role="alert">
      <strong>Business OS data is unavailable.</strong>
      <div>{error}</div>
      <div className="source">No substitute or estimated values are shown.</div>
    </div>
  );
}

function OperatingBoundary() {
  return (
    <div className="control-boundary" role="note">
      <strong>Control-plane boundary:</strong> this HQ reads local or explicitly imported evidence.
      It does not infer buyer intent, publish content, send consequential outreach, or execute an
      automation merely because a record appears here.
    </div>
  );
}

function OwnerDashboard() {
  const [brief, setBrief] = useState<OwnerBriefResponse>();
  const [error, setError] = useState('');

  useEffect(() => {
    hqRequest<OwnerBriefResponse>(businessOsPaths.ownerBrief)
      .then(setBrief)
      .catch((caught) => setError(readableError(caught)));
  }, []);

  if (error) return <ErrorState error={error} />;
  if (!brief) return <LoadingState>Loading the local owner brief…</LoadingState>;

  const metrics = [
    {
      key: 'attention',
      label: 'Founder decisions waiting',
      value: brief.metrics.attention,
      href: '/attention',
    },
    {
      key: 'at-risk',
      label: 'At-risk households',
      value: brief.metrics.atRiskHouseholds,
      href: '/customers',
    },
    {
      key: 'universe',
      label: 'Imported credit-union universe',
      value: brief.metrics.creditUnionUniverse,
      href: '/targets',
    },
    {
      key: 'open-opportunities',
      label: 'Open opportunities',
      value: brief.metrics.openOpportunities,
      href: '/pipeline',
    },
    {
      key: 'stale-opportunities',
      label: 'Stale opportunities',
      value: brief.metrics.staleOpportunities,
      href: '/pipeline',
    },
  ];

  return (
    <>
      <OperatingBoundary />
      <div className="snapshot-row section">
        <EvidenceLabel>Local or imported evidence</EvidenceLabel>
        <span className="source">Generated {new Date(brief.generatedAt).toLocaleString()}</span>
      </div>
      <section className="metric-grid metric-grid-five section" aria-label="Owner brief metrics">
        {metrics.map((metric) => (
          <article className="hq-card metric-card" key={metric.key}>
            <h2>{metric.label}</h2>
            <p className="metric-value">{integerFormatter.format(metric.value)}</p>
            <Link href={metric.href}>Inspect source records</Link>
          </article>
        ))}
      </section>
      <section className="control-grid section" aria-labelledby="owner-controls-heading">
        <div className="section-heading control-grid-heading">
          <h2 id="owner-controls-heading">Owner control plane</h2>
        </div>
        <Link className="hq-card control-link" href="/attention">
          <strong>Attention queue</strong>
          <span>
            See why you are required, the recommended decision, deadline, and consequence.
          </span>
        </Link>
        <Link className="hq-card control-link" href="/pipeline">
          <strong>Opportunity discipline</strong>
          <span>Resolve stale reasons and assign the next human action.</span>
        </Link>
        <Link className="hq-card control-link" href="/autonomy">
          <strong>Autonomy controls</strong>
          <span>
            Keep actions disabled, require approval, or evaluate a policy without execution.
          </span>
        </Link>
      </section>
    </>
  );
}

function CreditUnionTargets() {
  const [data, setData] = useState<CreditUnionTargetsResponse>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [minimumFitScore, setMinimumFitScore] = useState('0');
  const [memberSegment, setMemberSegment] = useState('');

  const loadTargets = useCallback(async (minimumScore: string, segment: string) => {
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ limit: '100', minimumFitScore: minimumScore });
    if (segment) query.set('memberSegment', segment);
    try {
      setData(
        await hqRequest<CreditUnionTargetsResponse>(
          `${businessOsPaths.creditUnions}?${query.toString()}`,
        ),
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const query = new URLSearchParams({ limit: '100', minimumFitScore: '0' });
    hqRequest<CreditUnionTargetsResponse>(`${businessOsPaths.creditUnions}?${query.toString()}`)
      .then(setData)
      .catch((caught) => setError(readableError(caught)))
      .finally(() => setLoading(false));
  }, []);

  function filter(event: FormEvent) {
    event.preventDefault();
    void loadTargets(minimumFitScore, memberSegment);
  }

  return (
    <>
      <OperatingBoundary />
      <div className="notice section">
        <strong>Segmentation is not intent.</strong> NCUA fixed-snapshot fields support an
        explainable fit hypothesis only. Inclusion does not establish interest, consent, a lead, or
        permission to contact an institution.
      </div>
      <form className="filter-bar section" onSubmit={filter}>
        <div>
          <label htmlFor="target-segment">Member segment</label>
          <select
            id="target-segment"
            value={memberSegment}
            onChange={(event) => setMemberSegment(event.target.value)}
          >
            <option value="">All imported segments</option>
            {Object.entries(segmentLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="target-score">Minimum explainable fit score</label>
          <input
            id="target-score"
            inputMode="numeric"
            max="100"
            min="0"
            type="number"
            value={minimumFitScore}
            onChange={(event) => setMinimumFitScore(event.target.value)}
          />
        </div>
        <button className="secondary filter-action" disabled={loading} type="submit">
          {loading ? 'Filtering…' : 'Apply filters'}
        </button>
      </form>
      {error ? (
        <div className="section">
          <ErrorState error={error} />
        </div>
      ) : loading || !data ? (
        <LoadingState>Loading the imported credit-union snapshot…</LoadingState>
      ) : (
        <>
          <div className="snapshot-row section">
            <EvidenceLabel>
              {data.dataState === 'official_fixed_snapshot'
                ? 'Official fixed snapshot'
                : 'Snapshot unavailable'}
            </EvidenceLabel>
            <span>{data.limitation}</span>
          </div>
          {data.targets.length === 0 ? (
            <p className="empty">No imported institutions match these filters.</p>
          ) : (
            <section className="target-grid section" aria-label="Credit-union target segments">
              {data.targets.map((target) => (
                <article className="hq-card target-card" key={target.charterNumber}>
                  <div className="card-heading-row">
                    <div>
                      <h2>{target.name}</h2>
                      <p className="source">
                        {target.city}, {target.state} · Charter {target.charterNumber}
                      </p>
                    </div>
                    <div className="fit-score" aria-label={`Fit score ${target.fitScore} of 100`}>
                      <strong>{target.fitScore}</strong>
                      <span>/ 100 fit</span>
                    </div>
                  </div>
                  <dl className="data-list">
                    <div>
                      <dt>Member segment</dt>
                      <dd>{segmentLabels[target.memberSegment]}</dd>
                    </div>
                    <div>
                      <dt>Members</dt>
                      <dd>{integerFormatter.format(target.members)}</dd>
                    </div>
                    <div>
                      <dt>Assets</dt>
                      <dd>{currencyFormatter.format(target.assets)}</dd>
                    </div>
                    <div>
                      <dt>Low-income designation</dt>
                      <dd>{target.lowIncomeDesignation ? 'Yes' : 'No'}</dd>
                    </div>
                  </dl>
                  <h3>Why this fit score</h3>
                  {target.fitReasons.length ? (
                    <ul className="reason-list">
                      {target.fitReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">No fit reason was supplied.</p>
                  )}
                  <div className="truth-row">
                    <EvidenceLabel>Official fixed snapshot</EvidenceLabel>
                    <strong>Intent claimed: {target.intentClaimed ? 'Yes' : 'No'}</strong>
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}

function CreateOpportunity({ onCreated }: { onCreated: () => void }) {
  const [organizationId, setOrganizationId] = useState('');
  const [name, setName] = useState('');
  const [amountMinor, setAmountMinor] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [useCase, setUseCase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await hqRequest(businessOsPaths.opportunities, {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          name,
          ...(amountMinor ? { amountMinor: Number(amountMinor), currency } : {}),
          ...(useCase ? { useCase } : {}),
        }),
      });
      setName('');
      setAmountMinor('');
      setUseCase('');
      setMessage('Opportunity saved locally. No outreach was sent.');
      onCreated();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="hq-card action-panel">
      <summary>Create a local opportunity</summary>
      <p className="source">
        Use an existing imported organization ID. A target record is not promoted automatically.
      </p>
      <form className="form-grid" onSubmit={submit}>
        <div>
          <label htmlFor="opportunity-organization">Organization ID</label>
          <input
            id="opportunity-organization"
            minLength={3}
            required
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="opportunity-name">Opportunity name</label>
          <input
            id="opportunity-name"
            maxLength={240}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="opportunity-amount">Amount in minor units (optional)</label>
          <input
            id="opportunity-amount"
            inputMode="numeric"
            min="0"
            type="number"
            value={amountMinor}
            onChange={(event) => setAmountMinor(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="opportunity-currency">Currency</label>
          <input
            id="opportunity-currency"
            maxLength={3}
            pattern="[A-Z]{3}"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </div>
        <div className="form-span">
          <label htmlFor="opportunity-use-case">Use case (optional)</label>
          <textarea
            id="opportunity-use-case"
            maxLength={1000}
            value={useCase}
            onChange={(event) => setUseCase(event.target.value)}
          />
        </div>
        {error && (
          <p className="error form-span" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="success-message form-span" role="status">
            {message}
          </p>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Save opportunity'}
        </button>
      </form>
    </details>
  );
}

function OpportunityActions({
  opportunity,
  onChanged,
}: {
  opportunity: Opportunity;
  onChanged: () => void;
}) {
  const [nextStage, setNextStage] = useState<OpportunityStage>(opportunity.stage);
  const [reason, setReason] = useState('');
  const [nextAction, setNextAction] = useState(opportunity.recommendedAction ?? '');
  const [nextActionAt, setNextActionAt] = useState('');
  const [busyAction, setBusyAction] = useState<'transition' | 'next-action'>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function transition(event: FormEvent) {
    event.preventDefault();
    setBusyAction('transition');
    setError('');
    setMessage('');
    try {
      await hqRequest(
        `${businessOsPaths.opportunities}/${encodeURIComponent(opportunity.id)}/transitions`,
        {
          method: 'POST',
          body: JSON.stringify({ nextStage, reason }),
        },
      );
      setReason('');
      setMessage('Stage transition recorded locally. No outreach was sent.');
      onChanged();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function setAction(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    const date = new Date(nextActionAt);
    if (Number.isNaN(date.valueOf())) {
      setError('Choose a valid next-action date and time.');
      return;
    }
    setBusyAction('next-action');
    try {
      await hqRequest(
        `${businessOsPaths.opportunities}/${encodeURIComponent(opportunity.id)}/next-action`,
        {
          method: 'PUT',
          body: JSON.stringify({ nextAction, nextActionAt: date.toISOString() }),
        },
      );
      setMessage('Next human action recorded locally. Nothing was sent automatically.');
      onChanged();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusyAction(undefined);
    }
  }

  const fieldKey = opportunity.id.replace(/[^A-Za-z0-9_-]/gu, '-');

  return (
    <details className="action-panel nested-action-panel">
      <summary>Update stage or next action</summary>
      <div className="split-actions">
        <form className="form-stack" onSubmit={transition}>
          <h3>Record a stage transition</h3>
          <label htmlFor={`stage-${fieldKey}`}>Next stage</label>
          <select
            id={`stage-${fieldKey}`}
            value={nextStage}
            onChange={(event) => setNextStage(event.target.value as OpportunityStage)}
          >
            {opportunityStages.map((stage) => (
              <option key={stage} value={stage}>
                {stage.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <label htmlFor={`reason-${fieldKey}`}>Reason</label>
          <textarea
            id={`reason-${fieldKey}`}
            maxLength={1000}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button className="secondary" disabled={busyAction !== undefined} type="submit">
            {busyAction === 'transition' ? 'Recording…' : 'Record transition'}
          </button>
        </form>
        <form className="form-stack" onSubmit={setAction}>
          <h3>Assign the next human action</h3>
          <label htmlFor={`next-action-${fieldKey}`}>Next action</label>
          <textarea
            id={`next-action-${fieldKey}`}
            maxLength={1000}
            required
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
          />
          <label htmlFor={`next-action-at-${fieldKey}`}>Due date and time</label>
          <input
            id={`next-action-at-${fieldKey}`}
            required
            type="datetime-local"
            value={nextActionAt}
            onChange={(event) => setNextActionAt(event.target.value)}
          />
          <button className="secondary" disabled={busyAction !== undefined} type="submit">
            {busyAction === 'next-action' ? 'Recording…' : 'Set next action'}
          </button>
        </form>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
    </details>
  );
}

function OpportunityPipeline() {
  const [data, setData] = useState<OpportunityQueueResponse>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadOpportunities = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await hqRequest<OpportunityQueueResponse>(businessOsPaths.opportunities));
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hqRequest<OpportunityQueueResponse>(businessOsPaths.opportunities)
      .then(setData)
      .catch((caught) => setError(readableError(caught)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <OperatingBoundary />
      <div className="truth-strip section">
        <strong>Automatic consequential outreach: Off</strong>
        <span>Records can schedule human work; they cannot send messages or make commitments.</span>
      </div>
      <div className="section">
        <CreateOpportunity onCreated={() => void loadOpportunities()} />
      </div>
      {error ? (
        <div className="section">
          <ErrorState error={error} />
        </div>
      ) : loading || !data ? (
        <LoadingState>Loading the local opportunity queue…</LoadingState>
      ) : data.opportunities.length === 0 ? (
        <p className="empty section">No local opportunities exist.</p>
      ) : (
        <section className="pipeline-list section" aria-label="Opportunity queue">
          {data.opportunities.map((opportunity) => (
            <article
              className={`hq-card pipeline-card${opportunity.stale ? ' is-stale' : ''}`}
              key={opportunity.id}
            >
              <div className="card-heading-row">
                <div>
                  <EvidenceLabel>
                    {opportunity.stale ? 'Stale — decision needed' : 'Current'}
                  </EvidenceLabel>
                  <h2>{opportunity.name}</h2>
                  <p className="source">
                    {opportunity.organizationName} · {opportunity.id}
                  </p>
                </div>
                <span className="stage-pill">{opportunity.stage.replaceAll('_', ' ')}</span>
              </div>
              <dl className="decision-list">
                <div>
                  <dt>Why it is stale or blocked</dt>
                  <dd>
                    {opportunity.reasons.length ? (
                      <ul className="reason-list compact-list">
                        {opportunity.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      'No stale reason reported.'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Recommended next action</dt>
                  <dd>{opportunity.recommendedAction ?? 'No recommendation supplied.'}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{opportunity.ownerPersonId ?? 'Unassigned'}</dd>
                </div>
              </dl>
              <OpportunityActions
                opportunity={opportunity}
                onChanged={() => void loadOpportunities()}
              />
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function OwnerAttention() {
  const [data, setData] = useState<AttentionResponse>();
  const [error, setError] = useState('');

  useEffect(() => {
    hqRequest<AttentionResponse>(businessOsPaths.attention)
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);

  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingState>Loading the owner attention queue…</LoadingState>;

  const openItems = data.items.filter((item) => item.state === 'open');

  return (
    <>
      <OperatingBoundary />
      <div className="snapshot-row section">
        <EvidenceLabel>Founder-only decisions</EvidenceLabel>
        <span>
          {openItems.length} open of {data.items.length} local items
        </span>
      </div>
      {data.items.length === 0 ? (
        <p className="empty section">No owner-attention items are recorded locally.</p>
      ) : (
        <section className="attention-list section" aria-label="Owner attention items">
          {data.items.map((item) => (
            <article className={`hq-card attention-card state-${item.state}`} key={item.id}>
              <div className="card-heading-row">
                <div>
                  <EvidenceLabel>{item.state}</EvidenceLabel>
                  <h2>{item.attentionKind.replaceAll('_', ' ')}</h2>
                </div>
                <span className="source">
                  {item.sourceType} · {item.sourceId}
                </span>
              </div>
              <dl className="decision-list">
                <div>
                  <dt>Why the founder is required</dt>
                  <dd>{item.whyFounderRequired}</dd>
                </div>
                <div>
                  <dt>Recommended decision or action</dt>
                  <dd>{item.recommendedAction}</dd>
                </div>
                <div>
                  <dt>Consequence of inaction</dt>
                  <dd>{item.consequenceOfInaction}</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>
                    {item.deadline
                      ? new Date(item.deadline).toLocaleString()
                      : 'No deadline recorded'}
                  </dd>
                </div>
              </dl>
              <p className="source">
                Updated {new Date(item.updatedAt).toLocaleString()} · Item {item.id}
              </p>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function parseTokens(value: string, fieldName: string): string[] {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  const invalid = tokens.find((token) => !/^[a-z0-9][a-z0-9._-]*$/iu.test(token));
  if (invalid) throw new Error(`${fieldName} contains an invalid token: ${invalid}`);
  return tokens;
}

function parseGlobalAutomationControl(value: unknown): GlobalAutomationControl {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('killSwitch' in value) ||
    typeof value.killSwitch !== 'boolean'
  ) {
    throw new Error('The global automation control returned an invalid state.');
  }
  const updatedAt =
    'updatedAt' in value && typeof value.updatedAt === 'string' ? value.updatedAt : undefined;
  return { killSwitch: value.killSwitch, ...(updatedAt === undefined ? {} : { updatedAt }) };
}

function readableTimestamp(value: string | undefined): string {
  if (value === undefined) return 'No update timestamp supplied';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Update timestamp unavailable' : date.toLocaleString();
}

function AutonomyControls() {
  const [globalControl, setGlobalControl] = useState<GlobalAutomationControl>();
  const [globalControlLoading, setGlobalControlLoading] = useState(true);
  const [globalControlBusy, setGlobalControlBusy] = useState(false);
  const [globalControlError, setGlobalControlError] = useState('');
  const [globalControlMessage, setGlobalControlMessage] = useState('');
  const [clearGlobalConfirmed, setClearGlobalConfirmed] = useState(false);
  const [action, setAction] = useState('');
  const [allowedDataClasses, setAllowedDataClasses] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [autonomy, setAutonomy] = useState<AutonomyClass>('approval');
  const [budgetCents, setBudgetCents] = useState('0');
  const [enabled, setEnabled] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [policyMessage, setPolicyMessage] = useState('');

  const [evaluationAction, setEvaluationAction] = useState('');
  const [evaluationDataClasses, setEvaluationDataClasses] = useState('');
  const [evaluationTool, setEvaluationTool] = useState('');
  const [estimatedCostCents, setEstimatedCostCents] = useState('0');
  const [evaluation, setEvaluation] = useState<EvaluationResponse>();
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [evaluationError, setEvaluationError] = useState('');

  const globalKillSwitchEngaged = globalControl?.killSwitch ?? true;
  const globalControlKnown = globalControl !== undefined && !globalControlLoading;

  useEffect(() => {
    hqRequest<unknown>(businessOsPaths.autonomyGlobalControl)
      .then((value) => setGlobalControl(parseGlobalAutomationControl(value)))
      .catch((caught) => setGlobalControlError(readableError(caught)))
      .finally(() => setGlobalControlLoading(false));
  }, []);

  async function updateGlobalControl(killSwitch: boolean) {
    if (!killSwitch && (!globalControlKnown || !clearGlobalConfirmed)) return;
    setGlobalControlBusy(true);
    setGlobalControlError('');
    setGlobalControlMessage('');
    try {
      const response = await hqRequest<unknown>(businessOsPaths.autonomyGlobalControl, {
        method: 'PUT',
        body: JSON.stringify({
          killSwitch,
          confirmation: killSwitch ? 'ENGAGE' : 'DISENGAGE',
        }),
      });
      const control = parseGlobalAutomationControl(response);
      setGlobalControl(control);
      setClearGlobalConfirmed(false);
      setGlobalControlMessage(
        control.killSwitch
          ? 'Global kill switch engaged. Automation routing is stopped.'
          : 'Global kill switch cleared with owner confirmation. No action was executed.',
      );
    } catch (caught) {
      setGlobalControl(undefined);
      setClearGlobalConfirmed(false);
      setGlobalControlError(readableError(caught));
    } finally {
      setGlobalControlBusy(false);
    }
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setPolicyBusy(true);
    setPolicyError('');
    setPolicyMessage('');
    try {
      await hqRequest(businessOsPaths.autonomyPolicies, {
        method: 'PUT',
        body: JSON.stringify({
          action,
          allowedDataClasses: parseTokens(allowedDataClasses, 'Allowed data classes'),
          allowedTools: parseTokens(allowedTools, 'Allowed tools'),
          autonomy,
          budgetCents: Number(budgetCents),
          enabled,
          requiresAudit: true,
        }),
      });
      setPolicyMessage(
        enabled
          ? globalKillSwitchEngaged
            ? globalControlKnown
              ? 'Local policy accepted as enabled, but the global kill switch blocks routing. No action ran.'
              : 'Local policy accepted as enabled, but HQ remains fail-closed until global state is confirmed. No action ran.'
            : 'Local policy accepted as enabled. This did not run the action.'
          : 'Local policy accepted as disabled. The per-action kill switch remains engaged.',
      );
    } catch (caught) {
      setPolicyError(readableError(caught));
    } finally {
      setPolicyBusy(false);
    }
  }

  async function evaluate(event: FormEvent) {
    event.preventDefault();
    setEvaluationBusy(true);
    setEvaluationError('');
    setEvaluation(undefined);
    try {
      setEvaluation(
        await hqRequest<EvaluationResponse>(businessOsPaths.autonomyEvaluate, {
          method: 'POST',
          body: JSON.stringify({
            action: evaluationAction,
            dataClasses: parseTokens(evaluationDataClasses, 'Data classes'),
            estimatedCostCents: Number(estimatedCostCents),
            tool: evaluationTool,
          }),
        }),
      );
    } catch (caught) {
      setEvaluationError(readableError(caught));
    } finally {
      setEvaluationBusy(false);
    }
  }

  return (
    <>
      <OperatingBoundary />
      <section
        className={`hq-card global-control section ${
          globalControlKnown
            ? globalKillSwitchEngaged
              ? 'is-engaged'
              : 'is-cleared'
            : 'is-unknown'
        }`}
        aria-labelledby="global-control-heading"
      >
        <div className="card-heading-row">
          <div>
            <EvidenceLabel>
              {globalControlKnown ? 'Authoritative server state' : 'Fail-closed local state'}
            </EvidenceLabel>
            <h2 id="global-control-heading">Global automation kill switch</h2>
          </div>
          <span className="global-control-status" aria-live="polite">
            {globalControlKnown
              ? globalKillSwitchEngaged
                ? 'ENGAGED'
                : 'CLEARED'
              : 'ENGAGED · FAIL-CLOSED'}
          </span>
        </div>
        <p>
          {!globalControlKnown
            ? 'Authoritative server state is unavailable. HQ remains locked in engaged mode and cannot clear the switch or authorize execution from an unknown state.'
            : globalKillSwitchEngaged
              ? 'Automation routing is stopped globally. Unknown or unavailable state is treated as engaged.'
              : 'The global stop is cleared. Every action still needs an enabled policy, an allowed tool and data class, sufficient budget, audit, and its required human disposition.'}
        </p>
        <p className="source">
          {globalControlKnown
            ? `Server state updated: ${readableTimestamp(globalControl.updatedAt)}`
            : globalControlLoading
              ? 'Confirming server state; fail-closed behavior remains active.'
              : 'Server state could not be confirmed; fail-closed behavior remains active.'}
        </p>
        {globalControlError && (
          <p className="error" role="alert">
            {globalControlError} The global switch is shown as engaged and cannot be cleared until
            authoritative state is available.
          </p>
        )}
        {globalControlMessage && (
          <p className="success-message" role="status">
            {globalControlMessage}
          </p>
        )}
        {globalKillSwitchEngaged ? (
          <form
            className="global-control-action"
            onSubmit={(event) => {
              event.preventDefault();
              void updateGlobalControl(false);
            }}
          >
            <label className="checkbox-row" htmlFor="clear-global-confirmation">
              <input
                checked={clearGlobalConfirmed}
                disabled={!globalControlKnown || globalControlBusy}
                id="clear-global-confirmation"
                type="checkbox"
                onChange={(event) => setClearGlobalConfirmed(event.target.checked)}
              />
              I understand that clearing the global stop permits only server-allowlisted, policy-
              bounded routing; it does not execute an action.
            </label>
            <button
              className="danger-action"
              disabled={!globalControlKnown || !clearGlobalConfirmed || globalControlBusy}
              type="submit"
            >
              {globalControlBusy ? 'Updating…' : 'Clear global kill switch'}
            </button>
          </form>
        ) : (
          <button
            className="primary"
            disabled={globalControlBusy}
            type="button"
            onClick={() => void updateGlobalControl(true)}
          >
            {globalControlBusy ? 'Engaging…' : 'Engage global kill switch'}
          </button>
        )}
      </section>
      <section className="autonomy-legend section" aria-labelledby="autonomy-classes-heading">
        <h2 id="autonomy-classes-heading">Autonomy classes</h2>
        <dl className="data-list class-list">
          <div>
            <dt>AUTO</dt>
            <dd>
              Only for a server-allowlisted safe action within an enabled, audited,
              data/tool/budget-bounded policy while the global switch is cleared.
            </dd>
          </div>
          <div>
            <dt>APPROVAL</dt>
            <dd>The owner must approve before any execution.</dd>
          </div>
          <div>
            <dt>HUMAN</dt>
            <dd>A person performs the task; the system may only prepare context.</dd>
          </div>
          <div>
            <dt>PROFESSIONAL</dt>
            <dd>Qualified legal, clinical, financial, or other specialist judgment is required.</dd>
          </div>
        </dl>
      </section>
      <div className="split-actions section">
        <section className="hq-card" aria-labelledby="policy-heading">
          <h2 id="policy-heading">Set a local action policy</h2>
          <div className={`kill-switch-state ${enabled ? 'is-enabled' : 'is-disabled'}`}>
            <strong>
              {!globalControlKnown
                ? 'Global control unknown — HQ is fail-closed'
                : globalKillSwitchEngaged
                  ? 'Global kill switch overrides this draft'
                  : `Draft per-action kill switch: ${enabled ? 'cleared' : 'engaged'}`}
            </strong>
            <span>
              {!globalControlKnown
                ? 'Action routing cannot be authorized from this screen'
                : globalKillSwitchEngaged
                  ? 'Action routing is blocked globally'
                  : enabled
                    ? autonomyLabels[autonomy]
                    : 'Action will be blocked'}
            </span>
          </div>
          <form className="form-stack section" onSubmit={savePolicy}>
            <label htmlFor="policy-action">Action token</label>
            <input
              id="policy-action"
              maxLength={100}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
              placeholder="example_action"
              required
              value={action}
              onChange={(event) => setAction(event.target.value)}
            />
            <label htmlFor="policy-data-classes">Allowed data-class tokens</label>
            <input
              id="policy-data-classes"
              placeholder="operational_metadata, aggregate_metrics"
              value={allowedDataClasses}
              onChange={(event) => setAllowedDataClasses(event.target.value)}
            />
            <label htmlFor="policy-tools">Allowed tool tokens</label>
            <input
              id="policy-tools"
              placeholder="local_database"
              value={allowedTools}
              onChange={(event) => setAllowedTools(event.target.value)}
            />
            <label htmlFor="policy-class">Autonomy class</label>
            <select
              id="policy-class"
              value={autonomy}
              onChange={(event) => setAutonomy(event.target.value as AutonomyClass)}
            >
              {Object.entries(autonomyLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label htmlFor="policy-budget">Maximum budget (cents)</label>
            <input
              id="policy-budget"
              inputMode="numeric"
              max="1000000"
              min="0"
              type="number"
              value={budgetCents}
              onChange={(event) => setBudgetCents(event.target.value)}
            />
            <label className="checkbox-row" htmlFor="policy-enabled">
              <input
                checked={enabled}
                id="policy-enabled"
                type="checkbox"
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Enable this action policy (still subordinate to the global kill switch)
            </label>
            <p className="source">Audit is always required and cannot be disabled here.</p>
            {policyError && (
              <p className="error" role="alert">
                {policyError}
              </p>
            )}
            {policyMessage && (
              <p className="success-message" role="status">
                {policyMessage}
              </p>
            )}
            <button className="primary" disabled={policyBusy} type="submit">
              {policyBusy ? 'Saving…' : 'Save local policy'}
            </button>
          </form>
        </section>
        <section className="hq-card" aria-labelledby="evaluation-heading">
          <h2 id="evaluation-heading">Evaluate without executing</h2>
          <p>
            This asks the policy engine for a disposition. It never runs the action or calls the
            selected tool.
          </p>
          <form className="form-stack" onSubmit={evaluate}>
            <label htmlFor="evaluation-action">Action token</label>
            <input
              id="evaluation-action"
              maxLength={100}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
              required
              value={evaluationAction}
              onChange={(event) => setEvaluationAction(event.target.value)}
            />
            <label htmlFor="evaluation-data-classes">Requested data-class tokens</label>
            <input
              id="evaluation-data-classes"
              value={evaluationDataClasses}
              onChange={(event) => setEvaluationDataClasses(event.target.value)}
            />
            <label htmlFor="evaluation-tool">Requested tool token</label>
            <input
              id="evaluation-tool"
              maxLength={100}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
              required
              value={evaluationTool}
              onChange={(event) => setEvaluationTool(event.target.value)}
            />
            <label htmlFor="evaluation-cost">Estimated cost (cents)</label>
            <input
              id="evaluation-cost"
              inputMode="numeric"
              max="1000000"
              min="0"
              type="number"
              value={estimatedCostCents}
              onChange={(event) => setEstimatedCostCents(event.target.value)}
            />
            {evaluationError && (
              <p className="error" role="alert">
                {evaluationError}
              </p>
            )}
            <button className="secondary" disabled={evaluationBusy} type="submit">
              {evaluationBusy ? 'Evaluating…' : 'Evaluate policy only'}
            </button>
          </form>
          {evaluation && (
            <div
              className={`evaluation-result ${evaluation.allowed ? 'is-allowed' : 'is-blocked'}`}
              role="status"
            >
              <strong>
                {evaluation.allowed ? 'Allowed for routing' : 'Not allowed'} ·{' '}
                {evaluation.disposition.toUpperCase()}
              </strong>
              <ul className="reason-list">
                {evaluation.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <span className="source">Evaluation run {evaluation.runId}; no action executed.</span>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function BusinessOsContent({ view }: { view: BusinessOsView }) {
  if (view === 'owner') return <OwnerDashboard />;
  if (view === 'targets') return <CreditUnionTargets />;
  if (view === 'pipeline') return <OpportunityPipeline />;
  if (view === 'attention') return <OwnerAttention />;
  return <AutonomyControls />;
}
