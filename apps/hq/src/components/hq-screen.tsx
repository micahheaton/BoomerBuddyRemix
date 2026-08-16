'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type {
  BrowserSessionResponse,
  DevPersonaId,
  HqOverviewResponse,
  HqRevenueResponse,
  MeResponse,
} from '@boomerbuddy/contracts';
import { apiPaths } from '@boomerbuddy/contracts';
import { hqRequest, readableError } from '../lib/api';

export type HqView = 'overview' | 'customers' | 'fraud' | 'revenue' | 'system';
type HouseholdResponse = {
  households: Array<{
    id: string;
    name: string;
    memberCount: number;
    orientationReadyCount: number;
    entitlementState: 'active' | 'inactive';
    dataState: 'local_development';
  }>;
};
type ChecksResponse = {
  checks: Array<{
    id: string;
    householdId: string;
    kind: 'text' | 'url';
    risk: string;
    providerState: string;
    createdAt: string;
    dataState: 'local_development';
  }>;
};
type ProvidersResponse = {
  providers: Array<{
    key: string;
    state: string;
    lastCheckedAt: string;
    detail: string;
    dataState: 'local_development';
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

const titles: Record<HqView, { title: string; subtitle: string }> = {
  overview: {
    title: 'Owner operating view',
    subtitle:
      'Local development data combines seed fixtures with this run. Nothing here is production evidence.',
  },
  customers: {
    title: 'Customers and access',
    subtitle: 'Household, orientation, and entitlement summaries from local development data.',
  },
  fraud: {
    title: 'Fraud and review',
    subtitle:
      'Operational result metadata only. Submitted artifact content is excluded by contract.',
  },
  revenue: {
    title: 'Revenue workspace',
    subtitle: 'Seeded research targets and follow-up cues—not a live CRM or verified pipeline.',
  },
  system: {
    title: 'System and audit',
    subtitle: 'Local provider states and metadata-only audit events.',
  },
};

function DataLabel({ state = 'local_development' }: { state?: 'local_development' | 'seeded' }) {
  return (
    <span className="seed-label">
      {state === 'seeded' ? 'Seeded research data' : 'Local development data (seed + this run)'}
    </span>
  );
}

function SignIn({ onSuccess }: { onSuccess: (me: MeResponse) => void }) {
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
  const reviewerOnly =
    me.principal.roles.includes('hq_reviewer') && !me.principal.roles.includes('hq_owner');
  return (
    <>
      <header className="hq-topbar">
        <Link className="hq-brand" href="/">
          <span className="hq-brand-mark">BB</span>
          <span>BoomerBuddy HQ</span>
        </Link>
        <span className="environment">Local development</span>
        <span>{me.principal.displayName}</span>
      </header>
      <div className="hq-layout">
        <nav className="hq-nav" aria-label="HQ navigation">
          {!reviewerOnly && <Link href="/">Overview</Link>}
          {!reviewerOnly && <Link href="/customers">Customers</Link>}
          <Link href="/fraud">Fraud & review</Link>
          {!reviewerOnly && <Link href="/revenue">Revenue</Link>}
          {!reviewerOnly && <Link href="/system">System & audit</Link>}
          <button className="secondary" type="button" onClick={onSignOut}>
            Sign out
          </button>
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

function Overview() {
  const [data, setData] = useState<HqOverviewResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    hqRequest<HqOverviewResponse>(apiPaths.hqOverview)
      .then(setData)
      .catch((caught) => setError(readableError(caught)));
  }, []);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">Loading local development overview…</p>;
  return (
    <>
      <section className="metric-grid" aria-label="Local development owner metrics">
        {data.metrics.map((metric) => (
          <article className="hq-card" key={metric.key}>
            <DataLabel />
            <h2>{metric.label}</h2>
            <p className="metric-value">{metric.value.toLocaleString()}</p>
            <p className="source">
              Source: {metric.source}
              <br />
              Updated {new Date(metric.updatedAt).toLocaleString()}
            </p>
          </article>
        ))}
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>Owner attention queue</h2>
          <DataLabel />
        </div>
        {data.alerts.length ? (
          <ul className="alert-list">
            {data.alerts.map((alert) => (
              <li className={`hq-card alert alert-${alert.severity}`} key={alert.key}>
                <DataLabel />
                <strong>{alert.severity.toUpperCase()}</strong>
                <p>{alert.message}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No local development alerts.</p>
        )}
      </section>
      <div className="notice">
        <strong>Run 1 measurement limit:</strong> verified safe-action completion and
        time-to-first-safe-action are not instrumented. These counts are local operational proof,
        not outcome evidence; closing that metric gap remains a first-dollar blocker.
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
  if (!data) return <p role="status">Loading local development customers…</p>;
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
    </div>
  );
}

function Fraud() {
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
  if (!data) return <p role="status">Loading local development review queue…</p>;
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
  if (!providers || !audit) return <p role="status">Loading local development system data…</p>;
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

export function HqScreen({ view }: { view: HqView }) {
  const [me, setMe] = useState<MeResponse>();
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    hqRequest<MeResponse>(apiPaths.me)
      .then(setMe)
      .catch(() => setMe(undefined))
      .finally(() => setChecking(false));
  }, []);
  const reviewerOnly =
    me?.principal.roles.includes('hq_reviewer') === true &&
    me.principal.roles.includes('hq_owner') === false;
  useEffect(() => {
    if (reviewerOnly && view !== 'fraud') window.location.replace('/fraud');
  }, [reviewerOnly, view]);
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
  if (reviewerOnly && view !== 'fraud')
    return (
      <main id="hq-main" className="sign-in-shell">
        <p role="status">Opening the authorized review queue…</p>
      </main>
    );
  if (!me) return <SignIn onSuccess={setMe} />;
  return (
    <Shell me={me} view={view} onSignOut={() => void signOut()}>
      {view === 'overview' ? (
        <Overview />
      ) : view === 'customers' ? (
        <Customers />
      ) : view === 'fraud' ? (
        <Fraud />
      ) : view === 'revenue' ? (
        <Revenue />
      ) : (
        <System />
      )}
    </Shell>
  );
}
