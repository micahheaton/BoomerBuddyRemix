'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type {
  BrowserSessionResponse,
  DevPersonaId,
  HqReviewQueueResponse,
  HqRevenueResponse,
  HqSupportQueueResponse,
  MeResponse,
  PrivacyRequestDto,
} from '@boomerbuddy/contracts';
import { apiPaths } from '@boomerbuddy/contracts';
import { BusinessOsContent, type BusinessOsView } from './business-os';
import { BillingAuthority } from './billing-authority';
import { FeedbackLearning } from './feedback-learning';
import { FounderProvisioning } from './founder-provisioning';
import { FoundingHouseholds } from './founding-households';
import { ProductionHqSignOut } from './production-identity';
import { StripeControl } from './stripe-control';
import { hqRequest, readableError } from '../lib/api';

export type HqView =
  | 'overview'
  | 'customers'
  | 'fraud'
  | 'support'
  | 'revenue'
  | 'system'
  | 'privacy'
  | 'feedback'
  | 'provisioning'
  | 'founding-households'
  | 'billing-authority'
  | 'stripe-control'
  | Exclude<BusinessOsView, 'owner'>;
type HouseholdResponse = {
  households: Array<{
    id: string;
    name: string;
    memberCount: number;
    orientationReadyCount: number;
    entitlementState: 'active' | 'inactive';
    dataState: 'local_development' | 'live_database';
  }>;
  truncated: boolean;
};
type ChecksResponse = {
  checks: Array<{
    id: string;
    householdId: string;
    kind: 'text' | 'url';
    risk: string;
    providerState: string;
    createdAt: string;
    dataState: 'local_development' | 'live_database';
  }>;
};
type ProvidersResponse = {
  providers: Array<{
    key: string;
    state: string;
    lastCheckedAt: string;
    detail: string;
    dataState: 'local_development' | 'live_database';
  }>;
};
type AuditResponse = {
  events: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    outcome: string;
    actorPersonId?: string;
    occurredAt: string;
  }>;
};

const productionRuntime = process.env.NODE_ENV === 'production';

const titles: Record<HqView, { title: string; subtitle: string }> = {
  overview: {
    title: 'Owner operating view',
    subtitle: productionRuntime
      ? 'Private-beta database evidence only. Provider, human, and efficacy evidence remain separately labeled.'
      : 'Local and explicitly imported evidence only. Nothing here is production evidence.',
  },
  customers: {
    title: 'Customers and access',
    subtitle: productionRuntime
      ? 'Bounded household, orientation, and entitlement summaries from the private-beta database.'
      : 'Household, orientation, and entitlement summaries from local development data.',
  },
  fraud: {
    title: 'Fraud and review',
    subtitle:
      'Operational result metadata only. Submitted artifact content is excluded by contract.',
  },
  support: {
    title: 'Assigned support',
    subtitle: 'Only active cases assigned to this support employee. Customer content is excluded.',
  },
  revenue: {
    title: 'Revenue workspace',
    subtitle: 'Seeded research targets and follow-up cues—not a live CRM or verified pipeline.',
  },
  system: {
    title: 'System and audit',
    subtitle: 'Local provider states and metadata-only audit events.',
  },
  privacy: {
    title: 'Privacy operations',
    subtitle:
      'Identity review and content-free Run 3 inventory planning; no completed export, correction, restriction, or erasure is claimed.',
  },
  feedback: {
    title: 'Feedback learning',
    subtitle: productionRuntime
      ? 'Founder-scoped metadata and explicitly claimed minimized text; no media, provider, or outbound action runs.'
      : 'Local role-scoped metadata and explicitly assigned minimized text; no provider or external action runs.',
  },
  provisioning: {
    title: 'Founder provisioning',
    subtitle:
      'Secret-free provider status, exact manual gates, and evidence tiers. Status never activates a provider.',
  },
  'founding-households': {
    title: 'Founding Households',
    subtitle: productionRuntime
      ? 'Founder-gated, finite, identity-bound sponsor access—no card, automatic messaging, or public enrollment.'
      : 'Founder-gated, finite local sponsor access—no card, no messaging, and no production identity claim.',
  },
  'billing-authority': {
    title: 'Billing authority',
    subtitle:
      'Exact-household authority provisioning and incident revocation with immutable audit evidence.',
  },
  'stripe-control': {
    title: 'Stripe control plane',
    subtitle:
      'Owner-only, revision-safe Checkout, cohort, eligibility, and persisted preflight controls.',
  },
  targets: {
    title: 'Credit-union segmentation',
    subtitle: 'Official fixed-snapshot evidence for explainable fit—not leads or buyer intent.',
  },
  pipeline: {
    title: 'Opportunity control plane',
    subtitle: 'Local opportunity state, stale reasons, and accountable next human actions.',
  },
  attention: {
    title: 'Owner attention',
    subtitle: 'Only decisions that require founder judgment, with consequence and deadline.',
  },
  autonomy: {
    title: 'Autonomy controls',
    subtitle: 'Per-action classes, budgets, audit requirements, and kill-switch state.',
  },
};

function DataLabel({
  state = 'local_development',
}: {
  state?: 'local_development' | 'live_database' | 'seeded';
}) {
  return (
    <span className="seed-label">
      {state === 'seeded'
        ? 'Seeded research data'
        : productionRuntime
          ? 'Private-beta database evidence'
          : 'Local development data (seed + this run)'}
    </span>
  );
}

function DevelopmentSignIn({ onSuccess }: { onSuccess: (me: MeResponse) => void }) {
  const [personaId, setPersonaId] = useState<DevPersonaId>('hq-heidi');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await hqRequest<BrowserSessionResponse>(apiPaths.hqSession, {
        method: 'POST',
        body: JSON.stringify({ personaId }),
      });
      onSuccess({ principal: response.principal });
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="hq-main" className="sign-in-shell">
      <div className="sign-in-card">
        <span className="seed-label">Local development only</span>
        <h1>BoomerBuddy HQ</h1>
        <p>
          This separate audience exposes local development operational summaries from seed fixtures
          and this run. Customer artifact content is never an HQ field.
        </p>
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="hq-persona">HQ persona</label>
          <select
            id="hq-persona"
            value={personaId}
            onChange={(event) => setPersonaId(event.target.value as DevPersonaId)}
          >
            <option value="hq-heidi">Heidi — HQ owner</option>
            <option value="hq-riley">Riley — HQ reviewer</option>
            <option value="hq-sam">Sam — HQ support</option>
          </select>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Enter local HQ'}
          </button>
        </form>
      </div>
    </main>
  );
}

function Shell({
  me,
  view,
  onSignOut,
  children,
}: {
  me: MeResponse;
  view: HqView;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const isOwner = me.principal.roles.includes('hq_owner');
  const canReview = me.principal.roles.includes('hq_reviewer');
  const canSupport = me.principal.roles.includes('hq_support');
  const feedbackNavigationEnabled = process.env.NODE_ENV !== 'production' || isOwner;
  const editorialNavigationEnabled = process.env.NODE_ENV !== 'production';
  return (
    <>
      <header className="hq-topbar">
        <Link className="hq-brand" href="/">
          <span className="hq-brand-mark">BB</span>
          <span>BoomerBuddy HQ</span>
        </Link>
        <span className="environment">
          {process.env.NODE_ENV === 'production' ? 'Private beta' : 'Local development'}
        </span>
        <span>{me.principal.displayName}</span>
      </header>
      <div className="hq-layout">
        <nav className="hq-nav" aria-label="HQ navigation">
          {isOwner && <span className="nav-heading">Operate</span>}
          {isOwner && (
            <Link aria-current={view === 'overview' ? 'page' : undefined} href="/">
              Overview
            </Link>
          )}
          {isOwner && (
            <Link aria-current={view === 'customers' ? 'page' : undefined} href="/customers">
              Customers
            </Link>
          )}
          {(isOwner || canReview) && (
            <Link aria-current={view === 'fraud' ? 'page' : undefined} href="/fraud">
              Fraud & review
            </Link>
          )}
          {canSupport && (
            <Link aria-current={view === 'support' ? 'page' : undefined} href="/support">
              Assigned support
            </Link>
          )}
          {canSupport && process.env.NODE_ENV !== 'production' && (
            <Link href="/messaging">Messaging support</Link>
          )}
          {feedbackNavigationEnabled && (isOwner || canReview || canSupport) && (
            <Link aria-current={view === 'feedback' ? 'page' : undefined} href="/feedback">
              Feedback learning
            </Link>
          )}
          {editorialNavigationEnabled && (isOwner || canReview) && (
            <Link href="/editorial">Editorial intelligence</Link>
          )}
          {process.env.NODE_ENV !== 'production' && (isOwner || canReview) && (
            <Link href="/referrals">Referral credit evidence</Link>
          )}
          {isOwner && <span className="nav-heading">Build revenue</span>}
          {isOwner && (
            <Link aria-current={view === 'targets' ? 'page' : undefined} href="/targets">
              Credit-union targets
            </Link>
          )}
          {isOwner && (
            <Link aria-current={view === 'pipeline' ? 'page' : undefined} href="/pipeline">
              Opportunity pipeline
            </Link>
          )}
          {isOwner && (
            <Link aria-current={view === 'revenue' ? 'page' : undefined} href="/revenue">
              Revenue research
            </Link>
          )}
          {isOwner && <span className="nav-heading">Govern</span>}
          {isOwner && (
            <Link aria-current={view === 'attention' ? 'page' : undefined} href="/attention">
              Owner attention
            </Link>
          )}
          {isOwner && (
            <Link aria-current={view === 'autonomy' ? 'page' : undefined} href="/autonomy">
              Autonomy controls
            </Link>
          )}
          {isOwner && (
            <Link aria-current={view === 'privacy' ? 'page' : undefined} href="/privacy">
              Privacy requests
            </Link>
          )}
          {isOwner && (
            <Link aria-current={view === 'provisioning' ? 'page' : undefined} href="/provisioning">
              Founder provisioning
            </Link>
          )}
          {isOwner && (
            <Link
              aria-current={view === 'founding-households' ? 'page' : undefined}
              href="/founding-households"
            >
              Founding Households
            </Link>
          )}
          {isOwner && (
            <Link
              aria-current={view === 'billing-authority' ? 'page' : undefined}
              href="/billing-authority"
            >
              Billing authority
            </Link>
          )}
          {isOwner && (
            <Link
              aria-current={view === 'stripe-control' ? 'page' : undefined}
              href="/stripe-control"
            >
              Stripe controls
            </Link>
          )}
          {isOwner && (
            <Link aria-current={view === 'system' ? 'page' : undefined} href="/system">
              System & audit
            </Link>
          )}
          {process.env.NODE_ENV === 'production' ? (
            <ProductionHqSignOut onSignedOut={onSignOut} />
          ) : (
            <button className="secondary" type="button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </nav>
        <main className="hq-content" id="hq-main">
          <div className="hq-content-inner">
            <div className="hq-title-row">
              <div>
                <h1 className="hq-title">{titles[view].title}</h1>
                <p className="subtitle">{titles[view].subtitle}</p>
              </div>
              <DataLabel />
            </div>
            {children}
          </div>
        </main>
      </div>
    </>
  );
}

function Customers() {
  const [data, setData] = useState<HouseholdResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    hqRequest<HouseholdResponse>(apiPaths.hqHouseholds)
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data)
    return (
      <p role="status">
        {productionRuntime
          ? 'Loading private-beta customers…'
          : 'Loading local development customers…'}
      </p>
    );
  return (
    <div className="table-wrap">
      <table>
        <caption>
          Household access summary — <DataLabel />
        </caption>
        <thead>
          <tr>
            <th>Household</th>
            <th>Members</th>
            <th>Orientation ready</th>
            <th>Entitlement</th>
            <th>Data state</th>
          </tr>
        </thead>
        <tbody>
          {data.households.map((household) => (
            <tr key={household.id}>
              <td>
                <strong>{household.name}</strong>
                <div className="source">ID: {household.id}</div>
              </td>
              <td>{household.memberCount}</td>
              <td>{household.orientationReadyCount}</td>
              <td>{household.entitlementState}</td>
              <td>
                <DataLabel />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.truncated ? <p className="notice">Showing the first 100 households.</p> : null}
    </div>
  );
}

function OwnerFraud() {
  const [data, setData] = useState<ChecksResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    hqRequest<ChecksResponse>(apiPaths.hqChecks)
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data)
    return (
      <p role="status">
        {productionRuntime
          ? 'Loading the private-beta review queue…'
          : 'Loading local development review queue…'}
      </p>
    );
  return (
    <>
      <div className="notice">
        <strong>Content exclusion:</strong> this response contains identifiers, kind, risk, provider
        state, and time only. It cannot display submitted text or URL content.
      </div>
      <div className="table-wrap section">
        <table>
          <caption>
            Check metadata review — <DataLabel />
          </caption>
          <thead>
            <tr>
              <th>Check</th>
              <th>Household</th>
              <th>Kind</th>
              <th>Risk</th>
              <th>Provider</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {data.checks.map((check) => (
              <tr key={check.id}>
                <td>
                  {check.id}
                  <div>
                    <DataLabel />
                  </div>
                </td>
                <td>{check.householdId}</td>
                <td>{check.kind}</td>
                <td>{check.risk.replaceAll('_', ' ')}</td>
                <td>
                  <span className={`status status-${check.providerState}`}>
                    {check.providerState}
                  </span>
                </td>
                <td>{new Date(check.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AssignedReviewQueue() {
  const [data, setData] = useState<HqReviewQueueResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    hqRequest<HqReviewQueueResponse>(apiPaths.hqReviewQueue)
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">Loading assigned local review work…</p>;
  return (
    <>
      <div className="notice">
        <strong>Assigned-only projection:</strong> household identity, Check activity, risk output,
        provider output, summaries, and submitted content are excluded. Assignment does not grant
        restricted-content access.
      </div>
      <div className="table-wrap section">
        <table>
          <caption>
            Assigned fraud work cases — <DataLabel />
          </caption>
          <thead>
            <tr>
              <th>Case</th>
              <th>Severity</th>
              <th>State</th>
              <th>Routing</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map((reviewCase) => (
              <tr key={reviewCase.id}>
                <td>{reviewCase.id}</td>
                <td>{reviewCase.severity}</td>
                <td>{reviewCase.state.replaceAll('_', ' ')}</td>
                <td>{reviewCase.routingClass.replaceAll('_', ' ')}</td>
                <td>
                  {reviewCase.dueAt ? new Date(reviewCase.dueAt).toLocaleString() : 'No due time'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.cases.length === 0 ? <p>No fraud work cases are assigned.</p> : null}
        {data.truncated ? <p className="notice">Showing the first 100 assigned cases.</p> : null}
      </div>
    </>
  );
}

function SupportQueue() {
  const [data, setData] = useState<HqSupportQueueResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    hqRequest<HqSupportQueueResponse>(apiPaths.hqSupportQueue)
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">Loading assigned local support cases…</p>;
  return (
    <>
      <div className="notice">
        <strong>Assigned-only projection:</strong> this queue excludes household rosters,
        orientation, entitlement, Check/risk metadata, and submitted content. Restricted resources
        still require a separate exact, time-bound grant.
      </div>
      <div className="table-wrap section">
        <table>
          <caption>
            Assigned support cases — <DataLabel />
          </caption>
          <thead>
            <tr>
              <th>Case</th>
              <th>Household</th>
              <th>Purpose code</th>
              <th>Assigned</th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map((supportCase) => (
              <tr key={supportCase.id}>
                <td>{supportCase.id}</td>
                <td>
                  {supportCase.householdName}
                  <div className="source">ID: {supportCase.householdId}</div>
                </td>
                <td>{supportCase.purposeCode}</td>
                <td>{new Date(supportCase.assignedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.cases.length === 0 ? <p>No support cases are assigned.</p> : null}
        {data.truncated ? <p className="notice">Showing the first 100 assigned cases.</p> : null}
      </div>
    </>
  );
}

function Revenue() {
  const [data, setData] = useState<HqRevenueResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    hqRequest<HqRevenueResponse>(apiPaths.hqRevenue)
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">Loading seeded revenue workspace…</p>;
  return (
    <>
      {data.truncated ? (
        <p className="notice">Each revenue workspace collection is capped at 100 records.</p>
      ) : null}
      <section className="metric-grid">
        {data.savedSearches.map((search) => (
          <article className="hq-card" key={search.id}>
            <DataLabel state="seeded" />
            <h2>{search.name}</h2>
            <p className="metric-value">{search.resultCount}</p>
            <p className="source">Research results, not verified leads</p>
          </article>
        ))}
      </section>
      <section className="section table-wrap">
        <table>
          <caption>
            Target accounts — <DataLabel state="seeded" />
          </caption>
          <thead>
            <tr>
              <th>Account</th>
              <th>Segment</th>
              <th>Verification</th>
            </tr>
          </thead>
          <tbody>
            {data.targetAccounts.map((account) => (
              <tr key={account.id}>
                <td>{account.name}</td>
                <td>{account.segment}</td>
                <td>{account.verificationState}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="section table-wrap">
        <table>
          <caption>
            Opportunities — <DataLabel state="seeded" />
          </caption>
          <thead>
            <tr>
              <th>Opportunity</th>
              <th>Stage</th>
              <th>Owner</th>
              <th>Next action</th>
              <th>Staleness</th>
            </tr>
          </thead>
          <tbody>
            {data.opportunities.map((opportunity) => (
              <tr key={opportunity.id}>
                <td>
                  {opportunity.id}
                  <div className="source">Account {opportunity.accountId}</div>
                </td>
                <td>{opportunity.stage}</td>
                <td>{opportunity.owner}</td>
                <td>
                  {opportunity.nextAction}
                  <div className="source">
                    {new Date(opportunity.nextActionAt).toLocaleString()}
                  </div>
                </td>
                <td>{opportunity.stale ? 'Stale — review needed' : 'Current in seed data'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function System() {
  const [providers, setProviders] = useState<ProvidersResponse>();
  const [audit, setAudit] = useState<AuditResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      hqRequest<ProvidersResponse>(apiPaths.hqProviderHealth),
      hqRequest<AuditResponse>(apiPaths.hqAudit),
    ])
      .then(([providerData, auditData]) => {
        setProviders(providerData);
        setAudit(auditData);
      })
      .catch((caught) => setError(readableError(caught)));
  }, []);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!providers || !audit)
    return (
      <p role="status">
        {productionRuntime
          ? 'Loading private-beta system data…'
          : 'Loading local development system data…'}
      </p>
    );
  return (
    <>
      <section className="metric-grid">
        {providers.providers.map((provider) => (
          <article className="hq-card" key={provider.key}>
            <DataLabel />
            <h2>{provider.key}</h2>
            <p>
              <span className={`status status-${provider.state}`}>{provider.state}</span>
            </p>
            <p>{provider.detail}</p>
            <p className="source">
              Last checked {new Date(provider.lastCheckedAt).toLocaleString()}
            </p>
          </article>
        ))}
      </section>
      <section className="section table-wrap">
        <table>
          <caption>Audit metadata — no artifact content</caption>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Outcome</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {audit.events.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.occurredAt).toLocaleString()}</td>
                <td>{event.action}</td>
                <td>
                  {event.resourceType}
                  {event.resourceId ? ` · ${event.resourceId}` : ''}
                </td>
                <td>{event.outcome}</td>
                <td>{event.actorPersonId ?? 'system'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

type PrivacyQueueResponse = {
  requests: PrivacyRequestDto[];
  truncated: boolean;
  fulfillmentMode: 'evidence_plan_only';
  limitation: string;
};

function PrivacyOperations() {
  const [data, setData] = useState<PrivacyQueueResponse>();
  const [evidenceReference, setEvidenceReference] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return hqRequest<PrivacyQueueResponse>('/v1/hq/business-os/privacy-requests')
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function advance(
    requestId: string,
    action: 'verify_identity' | 'begin_review' | 'record_plan' | 'deny',
  ) {
    if (!evidenceReference.trim()) {
      setError('Enter a content-free evidence reference before changing request state.');
      return;
    }
    setBusy(`${requestId}:${action}`);
    setError('');
    try {
      await hqRequest(`/v1/hq/business-os/privacy-requests/${requestId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action, evidenceReference: evidenceReference.trim() }),
      });
      setEvidenceReference('');
      await load();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy('');
    }
  }

  if (!data && !error) return <p role="status">Loading privacy operations…</p>;
  return (
    <>
      <div className="control-boundary" role="note">
        <strong>Run 2 boundary:</strong> this queue records identity-review evidence and creates a
        content-free data-category/count plan. It does not deliver an export, erase records, or
        claim legal completion.
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-stack section">
        <label htmlFor="privacy-evidence-reference">Content-free evidence reference</label>
        <input
          id="privacy-evidence-reference"
          value={evidenceReference}
          maxLength={200}
          placeholder="case:reviewed-identity-001"
          onChange={(event) => setEvidenceReference(event.target.value)}
        />
        <p className="source">
          Do not enter identity documents, customer content, URLs, or secrets.
        </p>
      </div>
      <section className="control-grid section" aria-label="Privacy request queue">
        {data?.truncated ? (
          <p className="notice" role="status">
            Showing the newest 100 privacy requests. Refine or resolve the queue before relying on
            this view for completeness.
          </p>
        ) : null}
        {(data?.requests ?? []).map((request) => {
          const nextAction =
            request.state === 'received'
              ? 'verify_identity'
              : request.state === 'verified'
                ? 'begin_review'
                : request.state === 'in_progress' && request.plan === undefined
                  ? 'record_plan'
                  : undefined;
          return (
            <article className="hq-card" key={request.id}>
              <h2>{request.requestKind.replaceAll('_', ' ')} request</h2>
              <p>
                <strong>{request.state.replaceAll('_', ' ')}</strong> · Identity:{' '}
                {request.identityVerificationState.replaceAll('_', ' ')}
              </p>
              <p className="source">
                Request {request.id} · Due {new Date(request.dueAt).toLocaleString()}
              </p>
              {request.plan ? (
                <div className="notice">
                  <strong>{request.plan.kind.replaceAll('_', ' ')}</strong>
                  <p>{request.plan.dataCategories.join(', ')}</p>
                  <p>
                    Content included: no · Professional review:{' '}
                    {request.plan.requiresProfessionalReview ? 'required' : 'not required'}
                  </p>
                </div>
              ) : null}
              <div className="button-row">
                {nextAction ? (
                  <button
                    className="primary"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void advance(request.id, nextAction)}
                  >
                    {nextAction.replaceAll('_', ' ')}
                  </button>
                ) : null}
                {!['completed', 'denied'].includes(request.state) ? (
                  <button
                    className="secondary"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void advance(request.id, 'deny')}
                  >
                    Deny with evidence
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
        {data?.requests.length === 0 ? <p>No privacy requests are queued.</p> : null}
      </section>
    </>
  );
}

export function HqScreen({ view }: { view: HqView }) {
  const [me, setMe] = useState<MeResponse>();
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    hqRequest<MeResponse>(apiPaths.me)
      .then(setMe)
      .catch(() => setMe(undefined))
      .finally(() => setChecking(false));
  }, []);
  const isOwner = me?.principal.roles.includes('hq_owner') === true;
  const canReview = me?.principal.roles.includes('hq_reviewer') === true;
  const canSupport = me?.principal.roles.includes('hq_support') === true;
  const viewAllowed =
    me === undefined
      ? true
      : view === 'fraud'
        ? isOwner || canReview
        : view === 'feedback'
          ? isOwner || canReview || canSupport
          : view === 'support'
            ? canSupport
            : isOwner;
  const authorizedLanding = isOwner ? '/' : canReview ? '/fraud' : canSupport ? '/support' : '/';
  useEffect(() => {
    if (me && !viewAllowed) window.location.replace(authorizedLanding);
  }, [authorizedLanding, me, viewAllowed]);
  async function signOut() {
    try {
      await hqRequest(apiPaths.currentSession, { method: 'DELETE' });
    } finally {
      setMe(undefined);
    }
  }
  if (checking)
    return (
      <main id="hq-main" className="sign-in-shell">
        <p role="status">Checking HQ session…</p>
      </main>
    );
  if (me && !viewAllowed)
    return (
      <main id="hq-main" className="sign-in-shell">
        <p role="status">Opening the authorized HQ workspace…</p>
      </main>
    );
  if (!me) {
    if (process.env.NODE_ENV !== 'production') return <DevelopmentSignIn onSuccess={setMe} />;
    if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
      return (
        <main id="hq-main" className="sign-in-shell">
          <div className="sign-in-card">
            <span className="seed-label">Access closed</span>
            <h1>HQ identity is not configured</h1>
            <p className="error" role="alert">
              BoomerBuddy HQ remains unavailable until the separate Clerk HQ application and exact
              founder binding are configured.
            </p>
          </div>
        </main>
      );
    }
    return (
      <main id="hq-main" className="sign-in-shell">
        <div className="sign-in-card">
          <span className="seed-label">Founder-only private beta</span>
          <h1>BoomerBuddy HQ</h1>
          <p>Authenticate through the separately configured HQ identity realm.</p>
          <Link href="/sign-in">Open secure HQ sign in</Link>
        </div>
      </main>
    );
  }
  const businessOsView: BusinessOsView | undefined =
    view === 'overview'
      ? 'owner'
      : view === 'targets' || view === 'pipeline' || view === 'attention' || view === 'autonomy'
        ? view
        : undefined;
  return (
    <Shell
      me={me}
      view={view}
      onSignOut={() => {
        if (process.env.NODE_ENV === 'production') setMe(undefined);
        else void signOut();
      }}
    >
      {businessOsView ? (
        <BusinessOsContent view={businessOsView} />
      ) : view === 'customers' ? (
        <Customers />
      ) : view === 'fraud' ? (
        isOwner ? (
          <OwnerFraud />
        ) : (
          <AssignedReviewQueue />
        )
      ) : view === 'support' ? (
        <SupportQueue />
      ) : view === 'revenue' ? (
        <Revenue />
      ) : view === 'privacy' ? (
        <PrivacyOperations />
      ) : view === 'feedback' ? (
        <FeedbackLearning />
      ) : view === 'provisioning' ? (
        <FounderProvisioning />
      ) : view === 'founding-households' ? (
        <FoundingHouseholds />
      ) : view === 'billing-authority' ? (
        <BillingAuthority />
      ) : view === 'stripe-control' ? (
        <StripeControl />
      ) : (
        <System />
      )}
    </Shell>
  );
}
